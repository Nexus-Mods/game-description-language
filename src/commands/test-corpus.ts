import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseYaml } from '../parser/index.js';
import { validate } from '../schema/validator.js';
import { BuildErrors } from '../errors.js';
import { localCachePaths } from '../corpus/archive.js';
import { runCorpus } from '../corpus/runner.js';
import { fetchCorpus } from '../nexus/fetch-corpus.js';
import type { InstallerRule } from '../runtime/installer-engine.js';
import type { DocumentNode, InstallerNode, ValueNode, PredicateNode } from '../parser/ast.js';
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

const lowerRule = (inst: InstallerNode): InstallerRule => {
  if (inst.single) {
    return {
      id: inst.id,
      priority: inst.priority,
      when: lowerPredicate(inst.when),
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
    route: (inst.route ?? []).map(r => ({
      match:   { kind: r.match.kind,  pattern: r.match.pattern },
      anchor:  { kind: r.anchor.kind, pattern: r.anchor.pattern },
      take:    r.take,
      placeAt: flattenPlaceAt(r.placeAt),
      modType: r.modType,
    })),
  };
};

const flatVarsFromDoc = (doc: DocumentNode): Record<string, string> => {
  const vars: Record<string, string> = {
    store: 'steam', os: 'windows', arch: 'x64',
    installPath: '/games/Hello',
    executablePath: '/games/Hello/' + doc.game.executable,
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
    const modIds = args.modIds ?? [];
    if (modIds.length === 0) {
      process.stderr.write('--fetch requires --mods <id,id,…> until live enumeration lands\n');
      process.exit(1);
    }
    await fetchCorpus({
      gameDomain: doc.game.id,           // assume game.id == Nexus domain_name
      cacheDir: join(args.cwd, 'tests', 'cache'),
      modIds,
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

  const report = runCorpus(rules, archives, { vars: flatVarsFromDoc(doc) });

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
    `\nsummary: ${report.matched} matched, ${report.unmatched} unmatched, ${report.failed} failed, ${report.total} total\n`,
  );

  if (report.failed > 0) process.exit(1);
};
