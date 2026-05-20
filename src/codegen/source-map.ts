// Basic Source Map v3 emitter — coarse line mappings only. Enough so stack
// traces from inside an installer rule land near the right YAML line.

export interface SourceMap {
  version: 3;
  file: string;
  sourceRoot: '';
  sources: [string];     // single source: the YAML
  names: [];
  mappings: string;      // VLQ-encoded
}

const VLQ_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const VLQ_SHIFT = 5;
const VLQ_MASK  = (1 << VLQ_SHIFT) - 1;
const VLQ_CONT  = 1 << VLQ_SHIFT;

const encode = (n: number): string => {
  let v = n < 0 ? ((-n) << 1) | 1 : n << 1;
  let s = '';
  do {
    let digit = v & VLQ_MASK;
    v >>>= VLQ_SHIFT;
    if (v > 0) digit |= VLQ_CONT;
    s += VLQ_CHARS[digit]!;
  } while (v > 0);
  return s;
};

export interface LineMapping {
  generatedLine: number;     // 1-based
  yamlLine: number;          // 1-based
  yamlColumn: number;        // 1-based
}

export const buildSourceMap = (
  generatedTsFileName: string,
  yamlFileName: string,
  lineMappings: LineMapping[],
): SourceMap => {
  const byGenLine = new Map<number, LineMapping[]>();
  for (const m of lineMappings) {
    const arr = byGenLine.get(m.generatedLine) ?? [];
    arr.push(m);
    byGenLine.set(m.generatedLine, arr);
  }

  const maxLine = Math.max(0, ...byGenLine.keys());
  const lines: string[] = [];
  let prevSrcLine = 0;
  let prevSrcCol = 0;
  for (let gl = 1; gl <= maxLine; gl++) {
    const segs = byGenLine.get(gl) ?? [];
    if (segs.length === 0) { lines.push(''); continue; }
    const parts: string[] = [];
    let prevGenCol = 0;
    for (const m of segs) {
      const genCol = 0;
      const sourceIdx = 0;
      const srcLine = m.yamlLine - 1;
      const srcCol = m.yamlColumn - 1;
      parts.push(
        encode(genCol - prevGenCol) +
        encode(sourceIdx) +
        encode(srcLine - prevSrcLine) +
        encode(srcCol - prevSrcCol),
      );
      prevGenCol = genCol;
      prevSrcLine = srcLine;
      prevSrcCol = srcCol;
    }
    lines.push(parts.join(','));
  }

  return {
    version: 3,
    file: generatedTsFileName,
    sourceRoot: '',
    sources: [yamlFileName],
    names: [],
    mappings: lines.join(';'),
  };
};
