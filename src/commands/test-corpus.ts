import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseYaml } from '../parser/index.js';
import { validate } from '../schema/validator.js';
import { BuildErrors } from '../errors.js';
import { localCachePaths, readArchiveEntries } from '../corpus/archive.js';
import { runCorpus } from '../corpus/runner.js';
import { runValidators, type ValidatorDef } from '../corpus/validator-runner.js';
import { fetchCorpus } from '../nexus/fetch-corpus.js';
import type { InstallerRule } from '../runtime/installer-engine.js';
import type { DocumentNode, InstallerNode, ValidatorNode, ValueNode, PredicateNode } from '../parser/ast.js';
import type { PredicateExpr } from '../runtime/predicate.js';

// Lower AST → runtime shapes (separate from codegen's stringly-typed render).
const flattenPlaceAt = (v: ValueNode): string => {
  if (v.kind === 'literal') return String(v.raw);
  if (v.kind === 'interpolated') return v.template;
  throw new Error(`unsupported placeAt kind ${v.kind} in corpus runner`);
};

const lowerPredicate = (p: PredicateNode): PredicateExpr => {
  if (p.kind === 'hasFile')  return { kind: 'hasFile',  glob: p.pattern.pattern };
  if (p.kind === 'hasFiles') return { kind: 'hasFiles', globs: p.patterns.map(pat => pat.pattern) };
  if (p.kind === 'matches')  return { kind: 'matches',  regex: p.pattern.pattern };
  if (p.kind === 'any')      return { kind: 'any',      arms: p.arms.map(lowerPredicate) };
  if (p.kind === 'all')      return { kind: 'all',      arms: p.arms.map(lowerPredicate) };
  if (p.kind === 'not')      return { kind: 'not',      arm: lowerPredicate(p.arm) };
  // when
  if (p.expr.op === 'in') {
    return { kind: 'when', expr: { op: 'in', left: p.expr.left, right: p.expr.right } };
  }
  return { kind: 'when', expr: { op: p.expr.op, left: p.expr.left, right: p.expr.right } };
};

export const lowerRule = (inst: InstallerNode): InstallerRule => {
  if (inst.single) {
    return {
      id: inst.id,
      priority: inst.priority,
      when: lowerPredicate(inst.when),
      ...(inst.unless !== undefined && { unless: lowerPredicate(inst.unless) }),
      ...(inst.scope !== undefined && { scope: inst.scope }),
      single: {
        anchor: { kind: inst.single.anchor.kind, pattern: inst.single.anchor.pattern },
        take: inst.single.take,
        placeAt: flattenPlaceAt(inst.single.placeAt),
      },
      modType: inst.modType!,
    };
  }
  return {
    id: inst.id,
    priority: inst.priority,
    when: lowerPredicate(inst.when),
    ...(inst.unless !== undefined && { unless: lowerPredicate(inst.unless) }),
    ...(inst.scope !== undefined && { scope: inst.scope }),
    route: (inst.route ?? []).map(r => ({
      match:   { kind: r.match.kind,  pattern: r.match.pattern },
      anchor:  { kind: r.anchor.kind, pattern: r.anchor.pattern },
      take:    r.take,
      placeAt: flattenPlaceAt(r.placeAt),
      modType: r.modType,
    })),
  };
};

const flatVarsFromDoc = (
  doc: DocumentNode,
  opts: { store: string; installPath: string },
): Record<string, string> => {
  const vars: Record<string, string> = {
    store: opts.store, os: 'windows', arch: 'x64',
    installPath: opts.installPath,
    executablePath: opts.installPath + '/' + doc.game.executable,
  };
  for (const b of doc.context?.bindings ?? []) {
    if (b.value.kind === 'literal')      vars[b.name] = String(b.value.raw);
    if (b.value.kind === 'interpolated') vars[b.name] = b.value.template;
  }
  // Interpolate ${name} placeholders (up to 10 levels of nesting).
  for (let i = 0; i < 10; i++) {
    let changed = false;
    for (const k of Object.keys(vars)) {
      const replaced = (vars[k] as string).replace(/\$\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g, (_m, name) =>
        vars[name] !== undefined ? (vars[name] as string) : `\${${name}}`
      );
      if (replaced !== vars[k]) { vars[k] = replaced; changed = true; }
    }
    if (!changed) break;
  }
  return vars;
};

const lowerValidator = (v: ValidatorNode): ValidatorDef => ({
  id: v.id,
  name: v.name,
  when: lowerPredicate(v.when),
  assert: {
    ...(v.assert.matched !== undefined && { matched: v.assert.matched }),
    ...(v.assert.modType !== undefined && { modType: v.assert.modType }),
    ...(v.assert.placement !== undefined && {
      placement: v.assert.placement.map(p => ({
        files: p.files,
        ...(p.mustMatch !== undefined && { mustMatch: p.mustMatch }),
        ...(p.mustNotMatch !== undefined && { mustNotMatch: p.mustNotMatch }),
      })),
    }),
  },
});

export interface TestCorpusArgs {
  cwd: string;
  yamlPath?: string;
  fetch?: boolean;
  modIds?: number[];      // optional list of mod IDs to fetch manifests for
}

export const runTestCorpus = async (args: TestCorpusArgs): Promise<void> => {
  const yamlPath = args.yamlPath ?? join(args.cwd, 'game.yaml');
  const source = await readFile(yamlPath, 'utf8');
  const doc = parseYaml(source, yamlPath);
  const errs = validate(doc);
  if (errs.length) throw new BuildErrors(errs);

  if (args.fetch) {
    if (doc.tests?.corpus !== 'nexus') {
      process.stderr.write('--fetch requires `tests.corpus: nexus` in game.yaml\n');
      process.exit(1);
    }
    const modIds = args.modIds && args.modIds.length > 0 ? args.modIds : undefined;
    await fetchCorpus({
      gameDomain: doc.game.nexusDomain ?? doc.game.id,
      cacheDir: join(args.cwd, 'tests', 'cache'),
      ...(modIds !== undefined && { modIds }),
      onProgress: (e) => {
        const sym = e.kind === 'fetched' ? '↓' : e.kind === 'skipped' ? '·' : '✖';
        const tail = 'reason' in e ? `  ${e.reason}` : '';
        process.stdout.write(`  ${sym} ${e.archive}${tail}\n`);
      },
    });
  }

  const rules = (doc.installers ?? []).map(lowerRule);
  const archives = localCachePaths(args.cwd);

  if (archives.length === 0) {
    process.stdout.write('no archives in tests/cache/ — nothing to do\n');
    return;
  }

  const validatorDefs = (doc.validators ?? []).map(lowerValidator);

  // Build archive contents map once (file lists don't depend on the store).
  const archiveContents = new Map<string, readonly string[]>();
  for (const archive of archives) {
    try {
      archiveContents.set(archive, readArchiveEntries(archive));
    } catch { /* skip unreadable archives */ }
  }

  // Run the corpus (and validators) across every declared store, so store-scoped
  // installers and store-conditional placeAt templates are all exercised.
  const stores = doc.stores?.entries.map(e => e.id) ?? [];
  const storeMatrix = stores.length > 0 ? stores : ['steam'];
  const defaultInstallPath = `/games/${doc.game.id}`;

  let anyFailed = false;
  for (const store of storeMatrix) {
    const installPath = doc.tests?.scenarios?.[store]?.installPath ?? defaultInstallPath;
    const vars = flatVarsFromDoc(doc, { store, installPath });
    const report = runCorpus(rules, archives, { vars });

    process.stdout.write(`\n[${store}]\n`);
    for (const e of report.entries) {
      const name = e.archive.split('/').pop()!;
      if (e.error) {
        process.stdout.write(`  ✖ ${name}  ERROR  ${e.error}\n`);
      } else if (e.matchedInstaller) {
        process.stdout.write(`  ✓ ${name}  → ${e.matchedInstaller} (${e.planSize} files)\n`);
      } else {
        process.stdout.write(`  ? ${name}  no installer matched\n`);
      }
    }
    process.stdout.write(
      `  summary: ${report.matched} matched, ${report.unmatched} unmatched, ${report.failed} failed, ${report.total} total\n`,
    );
    if (report.failed > 0) anyFailed = true;

    if (validatorDefs.length > 0) {
      const vReport = runValidators(validatorDefs, report.entries, archiveContents, vars);
      process.stdout.write(`  validators:\n`);
      for (const r of vReport.results) {
        const name = r.archive.split('/').pop()!;
        if (r.passed) {
          process.stdout.write(`    ✓ [${r.validatorId}] ${name}\n`);
        } else {
          process.stdout.write(`    ✖ [${r.validatorId}] ${name}  ${r.message}\n`);
        }
      }
      process.stdout.write(
        `  validators: ${vReport.passed} passed, ${vReport.failed} failed, ${vReport.total} total\n`,
      );
      if (vReport.failed > 0) anyFailed = true;
    }
  }

  if (anyFailed) process.exit(1);
};
