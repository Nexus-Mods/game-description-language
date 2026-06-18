import type { DocumentNode, ValueNode } from '../parser/ast.js';
import type { BuildError } from '../errors.js';
import { SUPPORTED_SCHEMA_VERSIONS, ID_PATTERN } from './types.js';

// Resolve a ValueNode to a canonical template string by expanding ${var}
// references against the context bindings (taking the default arm for branches).
// Built-in/runtime vars (installPath, store, …) have no binding and are kept
// verbatim, so two values that reference the same vars flatten identically.
// Returns null if it bottoms out in a hook reference (unresolvable at build time).
const expandTemplate = (
  template: string,
  bindings: Map<string, ValueNode>,
  seen: Set<string>,
): string | null => {
  let unresolved = false;
  const out = template.replace(/\$\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g, (m, name: string) => {
    const binding = bindings.get(name);
    if (!binding || seen.has(name)) return m; // runtime built-in or cycle: keep literal
    const nested = flattenValue(binding, bindings, new Set(seen).add(name));
    if (nested === null) { unresolved = true; return m; }
    return nested;
  });
  return unresolved ? null : out;
};

const flattenValue = (
  v: ValueNode,
  bindings: Map<string, ValueNode>,
  seen: Set<string> = new Set(),
): string | null => {
  switch (v.kind) {
    case 'literal':       return String(v.raw);
    case 'interpolated':  return expandTemplate(v.template, bindings, seen);
    case 'storeBranch':
    case 'osBranch':
    case 'versionBranch': return flattenValue(v.default, bindings, seen);
    case 'hookRef':       return null;
  }
};

export const validate = (doc: DocumentNode): BuildError[] => {
  const errors: BuildError[] = [];

  if (!(SUPPORTED_SCHEMA_VERSIONS as readonly number[]).includes(doc.gdl)) {
    errors.push({
      code: 'GDL100',
      message: `schema version ${doc.gdl} is not supported`,
      span: doc.span,
      hint: `this build supports gdl: ${SUPPORTED_SCHEMA_VERSIONS.join(', ')}`,
    });
  }

  if (!ID_PATTERN.test(doc.game.id)) {
    errors.push({
      code: 'GDL101',
      message: `game.id \`${doc.game.id}\` must match ${ID_PATTERN}`,
      span: doc.game.span,
    });
  }

  if (!doc.game.name.trim()) {
    errors.push({
      code: 'GDL103',
      message: 'game.name is required',
      span: doc.game.span,
    });
  }

  if (!doc.game.executable.trim()) {
    errors.push({
      code: 'GDL104',
      message: 'game.executable is required',
      span: doc.game.span,
    });
  }

  if (doc.game.requiredFiles.length === 0) {
    errors.push({
      code: 'GDL105',
      message: 'game.requiredFiles must list at least one file',
      span: doc.game.span,
    });
  }

  if (doc.modTypes) {
    const seen = new Set<string>();
    for (const mt of doc.modTypes) {
      if (!ID_PATTERN.test(mt.id)) {
        errors.push({
          code: 'GDL106',
          message: `modType.id \`${mt.id}\` must match ${ID_PATTERN}`,
          span: mt.span,
        });
      }
      if (seen.has(mt.id)) {
        errors.push({
          code: 'GDL102',
          message: `duplicate modType id \`${mt.id}\``,
          span: mt.span,
        });
      }
      seen.add(mt.id);
    }
  }

  if (doc.stores) {
    const seen = new Set<string>();
    for (const e of doc.stores.entries) {
      if (seen.has(e.id)) {
        errors.push({
          code: 'GDL107',
          message: `duplicate store \`${e.id}\``,
          span: e.span,
        });
      }
      seen.add(e.id);
    }
  }

  if (doc.installers) {
    const declaredModTypes = new Set((doc.modTypes ?? []).map(mt => mt.id));
    const modTypePathById = new Map((doc.modTypes ?? []).map(mt => [mt.id, mt.path] as const));
    const bindings = new Map((doc.context?.bindings ?? []).map(b => [b.name, b.value] as const));
    const seenIds = new Set<string>();

    // Vortex deploys a mod to its modType's `path` (+ the installer's stripped
    // relative path); `placeAt` is only the test harness's stand-in for that
    // root. If the two resolve to different folders, every test passes while the
    // real install lands in the wrong place (e.g. a doubled LogicMods/LogicMods).
    const checkPlaceAt = (placeAt: ValueNode, modTypeId: string, span: typeof doc.span, label: string): void => {
      const mtPath = modTypePathById.get(modTypeId);
      if (!mtPath) return; // undeclared modType already reported as GDL110
      const at = flattenValue(placeAt, bindings);
      const to = flattenValue(mtPath, bindings);
      if (at === null || to === null || at === to) return;
      // `.`/empty means "defer to the modType path" — runtime ignores placeAt
      // and deploys to the modType path regardless, so this can never disagree;
      // it only opts the test out of asserting an absolute destination.
      if (at === '.' || at === '') return;
      errors.push({
        code: 'GDL114',
        message: `${label} places files at \`${at}\` but its modType \`${modTypeId}\` deploys to \`${to}\` — these must resolve to the same path`,
        span,
        hint: 'Vortex deploys to the modType path at runtime; `placeAt` is only the test-time root. Point them at the same folder.',
      });
    };

    for (const inst of doc.installers) {
      if (!ID_PATTERN.test(inst.id)) {
        errors.push({
          code: 'GDL113',
          message: `installer.id \`${inst.id}\` must match ${ID_PATTERN}`,
          span: inst.span,
        });
      }
      if (seenIds.has(inst.id)) {
        errors.push({
          code: 'GDL111',
          message: `duplicate installer id \`${inst.id}\``,
          span: inst.span,
        });
      }
      seenIds.add(inst.id);

      const hasSingle = inst.single !== undefined;
      const hasRoute  = inst.route  !== undefined;
      const hasCopy   = inst.copy   !== undefined;
      const hasHook   = inst.installHook !== undefined;
      const formCount = (hasSingle ? 1 : 0) + (hasRoute ? 1 : 0) + (hasCopy ? 1 : 0) + (hasHook ? 1 : 0);
      if (formCount !== 1) {
        errors.push({
          code: 'GDL112',
          message: 'installer must have exactly one of `single` (anchor/take/placeAt/modType), `route`, `copy` (stripCommonRoot/modType), or `install` (hook)',
          span: inst.span,
        });
      }
      const checkModTypeDeclared = (): string => {
        const mt = inst.modType ?? '';
        if (!declaredModTypes.has(mt)) {
          errors.push({
            code: 'GDL110',
            message: `installer \`${inst.id}\` references undeclared modType \`${mt}\``,
            span: inst.span,
            hint: declaredModTypes.size
              ? `declared modTypes: ${[...declaredModTypes].join(', ')}`
              : 'no modTypes declared',
          });
        }
        return mt;
      };
      if (hasSingle) {
        const mt = checkModTypeDeclared();
        // copy form deploys to the modType path directly (no placeAt), so it
        // has nothing to reconcile; single form's placeAt must agree.
        checkPlaceAt(inst.single!.placeAt, mt, inst.span, `installer \`${inst.id}\``);
      }
      if (hasCopy) {
        checkModTypeDeclared();
      }
      if (hasHook && inst.modType !== undefined && !declaredModTypes.has(inst.modType)) {
        errors.push({
          code: 'GDL110',
          message: `installer \`${inst.id}\` references undeclared modType \`${inst.modType}\``,
          span: inst.span,
          hint: declaredModTypes.size
            ? `declared modTypes: ${[...declaredModTypes].join(', ')}`
            : 'no modTypes declared',
        });
      }
      if (hasRoute) {
        for (const r of inst.route!) {
          if (!declaredModTypes.has(r.modType)) {
            errors.push({
              code: 'GDL110',
              message: `route entry in installer \`${inst.id}\` references undeclared modType \`${r.modType}\``,
              span: r.span,
            });
          }
          checkPlaceAt(r.placeAt, r.modType, r.span, `route entry in installer \`${inst.id}\``);
        }
      }
    }
  }

  if (doc.tests) {
    const declaredInstallers = new Set((doc.installers ?? []).map(i => i.id));
    const declaredModTypes   = new Set((doc.modTypes   ?? []).map(mt => mt.id));
    for (const c of doc.tests.cases) {
      if (!c.name.trim()) {
        errors.push({
          code: 'GDL120',
          message: 'test case name is required',
          span: c.span,
        });
      }
      if (c.archive.length === 0) {
        errors.push({
          code: 'GDL121',
          message: 'test case archive list cannot be empty',
          span: c.span,
        });
      }
      if (c.expect?.matched !== undefined && !declaredInstallers.has(c.expect.matched)) {
        errors.push({
          code: 'GDL122',
          message: `test case \`${c.name}\` expects matched installer \`${c.expect.matched}\` which is not declared`,
          span: c.span,
          hint: declaredInstallers.size
            ? `declared installers: ${[...declaredInstallers].join(', ')}`
            : 'no installers declared',
        });
      }
      if (c.expect?.modType !== undefined && !declaredModTypes.has(c.expect.modType)) {
        errors.push({
          code: 'GDL123',
          message: `test case \`${c.name}\` expects modType \`${c.expect.modType}\` which is not declared`,
          span: c.span,
        });
      }
    }
  }

  if (doc.validators) {
    const declaredInstallers = new Set((doc.installers ?? []).map(i => i.id));
    const declaredModTypes   = new Set((doc.modTypes   ?? []).map(mt => mt.id));
    const seenIds = new Set<string>();
    for (const v of doc.validators) {
      if (!v.id.trim()) {
        errors.push({ code: 'GDL170', message: 'validator id is required', span: v.span });
      }
      if (seenIds.has(v.id)) {
        errors.push({ code: 'GDL171', message: `duplicate validator id \`${v.id}\``, span: v.span });
      }
      seenIds.add(v.id);
      if (v.assert.matched !== undefined && !declaredInstallers.has(v.assert.matched)) {
        errors.push({
          code: 'GDL172',
          message: `validator \`${v.id}\` asserts matched installer \`${v.assert.matched}\` which is not declared`,
          span: v.assert.span,
          hint: declaredInstallers.size
            ? `declared installers: ${[...declaredInstallers].join(', ')}`
            : 'no installers declared',
        });
      }
      if (v.assert.modType !== undefined && !declaredModTypes.has(v.assert.modType)) {
        errors.push({
          code: 'GDL173',
          message: `validator \`${v.id}\` asserts modType \`${v.assert.modType}\` which is not declared`,
          span: v.assert.span,
        });
      }
      for (const p of v.assert.placement ?? []) {
        if (!p.files.trim()) {
          errors.push({
            code: 'GDL174',
            message: `validator \`${v.id}\` placement entry is missing \`files\``,
            span: p.span,
          });
        }
        // An empty-string glob is treated as unspecified: a blank `mustMatch` would
        // otherwise match nothing and silently fail every targeted file.
        const hasMatch = p.mustMatch !== undefined && p.mustMatch.trim() !== '';
        const hasNotMatch = p.mustNotMatch !== undefined && p.mustNotMatch.trim() !== '';
        if (!hasMatch && !hasNotMatch) {
          errors.push({
            code: 'GDL175',
            message: `validator \`${v.id}\` placement entry must specify a non-empty \`mustMatch\` and/or \`mustNotMatch\``,
            span: p.span,
          });
        }
      }
    }
  }

  if (doc.diagnostics) {
    const seenHooks = new Set<string>();
    for (const d of doc.diagnostics) {
      if (!d.hook.trim()) {
        errors.push({
          code: 'GDL192',
          message: 'diagnostic `hook` must not be empty',
          span: d.span,
        });
        continue;
      }
      if (seenHooks.has(d.hook)) {
        errors.push({
          code: 'GDL193',
          message: `duplicate diagnostic hook \`${d.hook}\``,
          span: d.span,
        });
      }
      seenHooks.add(d.hook);
    }
  }

  if (doc.nexus) {
    if (!Number.isInteger(doc.nexus.modId) || doc.nexus.modId <= 0) {
      errors.push({
        code: 'GDL130',
        message: '`nexus.modId` must be a positive integer (the mod-page id on Nexus)',
        span: doc.nexus.span,
      });
    }
    if (!Number.isInteger(doc.nexus.fileGroupId) || doc.nexus.fileGroupId <= 0) {
      errors.push({
        code: 'GDL131',
        message: '`nexus.fileGroupId` must be a positive integer (the file-group id Nexus assigns to your mod page)',
        span: doc.nexus.span,
      });
    }
    if (!doc.nexus.displayName.trim()) {
      errors.push({
        code: 'GDL132',
        message: '`nexus.displayName` is required (human-friendly name shown on uploads)',
        span: doc.nexus.span,
      });
    }
  }


  if (doc.toolbarActions) {
    const seen = new Set<string>();
    for (const action of doc.toolbarActions) {
      if (!ID_PATTERN.test(action.id)) {
        errors.push({
          code: 'GDL144',
          message: `toolbarAction.id \`${action.id}\` must match ${ID_PATTERN}`,
          span: action.span,
        });
      }
      if (seen.has(action.id)) {
        errors.push({
          code: 'GDL143',
          message: `duplicate toolbarAction id \`${action.id}\``,
          span: action.span,
        });
      }
      seen.add(action.id);
      if (!action.title.trim()) {
        errors.push({
          code: 'GDL142',
          message: 'toolbarAction.title is required',
          span: action.span,
        });
      }
    }
  }

  if (doc.setup) {
    for (let i = 0; i < doc.setup.ensureDirs.length; i++) {
      if (doc.setup.ensureDirs[i]!.trim() === '') {
        errors.push({
          code: 'GDL152',
          message: `setup.ensureDirs[${i}] must not be empty`,
          span: doc.setup.span,
        });
      }
    }
    const rf = doc.setup.requireFiles;
    if (rf) {
      if (rf.files.length === 0) {
        errors.push({
          code: 'GDL153',
          message: 'setup.requireFiles.files must not be empty',
          span: doc.setup.span,
        });
      }
      rf.files.forEach((f, i) => {
        if (f.trim() === '') {
          errors.push({
            code: 'GDL153',
            message: `setup.requireFiles.files[${i}] must not be empty`,
            span: doc.setup!.span,
          });
        }
      });
      if (rf.prompt.title.trim() === '') {
        errors.push({
          code: 'GDL154',
          message: 'setup.requireFiles.prompt.title must not be empty',
          span: doc.setup.span,
        });
      }
      if (rf.prompt.message.trim() === '') {
        errors.push({
          code: 'GDL154',
          message: 'setup.requireFiles.prompt.message must not be empty',
          span: doc.setup.span,
        });
      }
      if (rf.prompt.link) {
        const link = rf.prompt.link;
        if (link.label.trim() === '') {
          errors.push({
            code: 'GDL155',
            message: 'setup.requireFiles.prompt.link.label must not be empty',
            span: doc.setup.span,
          });
        }
        if (
          link.target.kind === 'mod' &&
          (link.target.domain.trim() === '' ||
            !Number.isFinite(link.target.modId) ||
            link.target.modId <= 0)
        ) {
          errors.push({
            code: 'GDL155',
            message: 'setup.requireFiles.prompt.link.mod needs a domain and a positive modId',
            span: doc.setup.span,
          });
        }
        if (link.target.kind === 'url' && link.target.url.trim() === '') {
          errors.push({
            code: 'GDL155',
            message: 'setup.requireFiles.prompt.link.url must not be empty',
            span: doc.setup.span,
          });
        }
      }
    }
  }
  // events.did-deploy: structural validation done in parser.
  // Hook resolution happens in the build step (alongside discovery.version's hook).

  // tests.scenarios cross-reference: every scenario key must name a declared
  // store, otherwise the override silently does nothing (the codegen lookup
  // falls through to the default path) and the operator typo goes unnoticed
  // until a user files a bug.
  if (doc.tests?.scenarios) {
    const declaredStores = new Set(doc.stores?.entries.map(e => e.id) ?? []);
    for (const key of Object.keys(doc.tests.scenarios)) {
      if (!declaredStores.has(key as never)) {
        errors.push({
          code: 'GDL085',
          message: `tests.scenarios.${key} references an undeclared store`,
          span: doc.tests.span,
          hint: declaredStores.size > 0
            ? `valid stores: ${[...declaredStores].join(', ')}`
            : 'declare the store under `stores:` first',
        });
      }
    }
  }

  return errors;
};
