import type { DocumentNode } from '../parser/ast.js';
import type { BuildError } from '../errors.js';
import { SUPPORTED_SCHEMA_VERSIONS, ID_PATTERN } from './types.js';

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
    const seenIds = new Set<string>();
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
      if (hasSingle === hasRoute) {
        errors.push({
          code: 'GDL112',
          message: 'installer must have exactly one of `single` (anchor/take/placeAt/modType) or `route`',
          span: inst.span,
        });
      }
      if (hasSingle) {
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
  }
  // events.did-deploy: structural validation done in parser.
  // Hook resolution happens in the build step (alongside discovery.version's hook).

  return errors;
};
