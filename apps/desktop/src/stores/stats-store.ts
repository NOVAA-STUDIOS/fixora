import type { RepairStats } from '@fixora/shared-types';
import { create } from 'zustand';

import { invoke } from '../lib/bridge.js';

type StatsState = {
  stats: RepairStats | null;
  refresh: () => Promise<void>;
};

/** The status bar's "⚡ X fixed today" — backed by the `repairs` table via `ai:getStats`.
 * Refreshed after every successful repair (ai-store.ts) and on mount. */
export const useStatsStore = create<StatsState>((set) => ({
  stats: null,
  refresh: async () => {
    const result = await invoke('ai:getStats', {});
    if (result.ok) set({ stats: result.value });
  },
}));
