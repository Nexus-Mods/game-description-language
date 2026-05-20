const PATTERN = /\$\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g;

export const interpolate = (
  template: string,
  ctx: Record<string, string | number | boolean>,
): string =>
  template.replace(PATTERN, (_, name: string) => {
    if (!(name in ctx)) throw new Error(`unbound variable \`${name}\` in template \`${template}\``);
    return String(ctx[name]);
  });

export const referencedNames = (template: string): string[] => {
  const names: string[] = [];
  for (const m of template.matchAll(PATTERN)) names.push(m[1]!);
  return names;
};
