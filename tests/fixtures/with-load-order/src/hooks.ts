// Fixture stubs for the `loadOrder:` block. Each hook gets Vortex's own
// arguments plus a trailing ctx ({ api, gameId, vars }).
type Entry = { id: string; name: string; enabled: boolean };
type Ctx = { api: unknown; gameId: string; vars: Record<string, string | number | boolean> };

export async function readLoadOrder(ctx: Ctx): Promise<Entry[]> {
  return [{ id: String(ctx.vars.dataPath ?? ''), name: 'data', enabled: true }];
}

export async function writeLoadOrder(loadOrder: Entry[], prev: Entry[], ctx: Ctx): Promise<void> {
  void loadOrder;
  void prev;
  void ctx;
}

export async function validateLoadOrder(prev: Entry[], current: Entry[], ctx: Ctx): Promise<undefined> {
  void prev;
  void current;
  void ctx;
  return undefined;
}
