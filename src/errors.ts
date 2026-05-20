export interface YamlSpan {
  file: string;
  line: number;      // 1-based
  column: number;    // 1-based
  offset: number;    // byte offset for tooling
  length: number;
}

export interface BuildError {
  code: string;            // stable identifier, e.g. "GDL001"
  message: string;
  span: YamlSpan;
  hint?: string;           // "did you mean ...?"
}

export class BuildErrors extends Error {
  constructor(public readonly errors: BuildError[]) {
    super(`GDL build failed with ${errors.length} error(s)`);
    this.name = 'BuildErrors';
  }
}

export const formatError = (err: BuildError): string => {
  const loc = `${err.span.file}:${err.span.line}:${err.span.column}`;
  const hint = err.hint ? `\n  hint: ${err.hint}` : '';
  return `${loc}: ${err.code}: ${err.message}${hint}`;
};
