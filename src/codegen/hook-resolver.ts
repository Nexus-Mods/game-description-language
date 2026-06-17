import ts from 'typescript';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { BuildError } from '../errors.js';
import { findHook } from '../schema/hook-catalog.js';

export const resolveHooks = async (
  cwd: string,
  referencedHookIds: string[],
  // Hook names that are user-chosen (e.g. custom installer hooks) rather than
  // fixed catalog entries. These are checked for existence + export only, not
  // catalog membership.
  exportOnlyHookIds: string[] = [],
): Promise<BuildError[]> => {
  if (referencedHookIds.length === 0 && exportOnlyHookIds.length === 0) return [];

  const hooksPath = join(cwd, 'src', 'hooks.ts');
  const span = { file: hooksPath, line: 1, column: 1, offset: 0, length: 0 };

  if (!existsSync(hooksPath)) {
    return [{
      code: 'GDL071',
      message: `\`src/hooks.ts\` is required because the YAML references hook(s): ${[...referencedHookIds, ...exportOnlyHookIds].join(', ')}`,
      span,
    }];
  }

  const program = ts.createProgram({
    rootNames: [hooksPath],
    options: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      strict: true,
      noEmit: true,
      skipLibCheck: true,
    },
  });
  const checker = program.getTypeChecker();
  const source = program.getSourceFile(hooksPath);
  if (!source) {
    return [{
      code: 'GDL072',
      message: `could not load \`src/hooks.ts\``,
      span,
    }];
  }

  const exportedNames = new Set<string>();
  ts.forEachChild(source, (node) => {
    if (ts.isVariableStatement(node) && node.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)) {
      for (const decl of node.declarationList.declarations) {
        if (ts.isIdentifier(decl.name)) exportedNames.add(decl.name.text);
      }
    }
    if (ts.isFunctionDeclaration(node) && node.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword) && node.name) {
      exportedNames.add(node.name.text);
    }
  });

  void checker; // Reserved for signature comparison in a future iteration; existence-only for MVP+Plan 2.

  const errors: BuildError[] = [];
  for (const id of referencedHookIds) {
    const entry = findHook(id);
    if (!entry) {
      errors.push({
        code: 'GDL073',
        message: `hook \`${id}\` is not in the GDL hook catalog`,
        span,
        hint: 'check spelling, or this hook id requires a newer GDL version',
      });
      continue;
    }
    if (!exportedNames.has(id)) {
      errors.push({
        code: 'GDL070',
        message: `\`src/hooks.ts\` does not export \`${id}\``,
        span,
        hint: `expected signature: ${entry.expectedSignature}`,
      });
    }
  }
  for (const id of exportOnlyHookIds) {
    if (!exportedNames.has(id)) {
      errors.push({
        code: 'GDL070',
        message: `\`src/hooks.ts\` does not export \`${id}\``,
        span,
        hint: 'custom installer hook: expected an exported InstallFn-shaped function',
      });
    }
  }
  return errors;
};
