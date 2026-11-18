// Fixture stubs for the `merges:` block: a MergeTest and a MergeFunc.
export const isTablesSds = (_game: unknown, _discovery: unknown) => ({
  baseFiles: () => [],
  filter: (filePath: string) => filePath.toLowerCase().endsWith('tables.sds'),
});

export async function mergeTablesSds(filePath: string, mergeDir: string): Promise<void> {
  void filePath;
  void mergeDir;
}
