import type { RepairHistoryEntry } from '@fixora/shared-types';
import { create } from 'zustand';

import { invoke } from '../../lib/bridge.js';

/**
 * The repair history view state (Beta Phase E). The trail itself lives in local SQLite (the store of
 * record); this holds the current view of it. It reloads on demand — when the History panel mounts and
 * after a repair is applied — so what the user sees is always the persisted truth.
 */
type HistoryState = {
  entries: RepairHistoryEntry[];
  loaded: boolean;
  refresh: () => Promise<void>;
};

export const useHistoryStore = create<HistoryState>((set) => ({
  entries: [],
  loaded: false,
  refresh: async () => {
    const result = await invoke('ai:history', {});
    set({ entries: result.ok ? result.value.entries : [], loaded: true });
  },
}));
