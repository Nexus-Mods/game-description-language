import type { GameContext } from '@gdl/runtime';

export const detectGameVersion = async (_ctx: GameContext): Promise<string | null> => {
  // Test stub — real implementation would parse the game exe.
  return '1.0.0';
};

export async function regenerateModsTxt(ctx: { profileId: string; deployment: unknown; api: unknown }): Promise<void> {
  // Fixture stub — real implementation would scan the UE4SS Mods folder and write mods.txt.
  void ctx;
}
