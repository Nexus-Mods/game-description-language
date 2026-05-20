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

  return errors;
};
