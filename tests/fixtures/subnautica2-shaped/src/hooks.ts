import type { GameContext } from '@gdl/runtime';

export const detectGameVersion = async (_ctx: GameContext): Promise<string | null> => {
  // Test stub — real implementation would parse the game exe.
  return '1.0.0';
};
