import type { CodeShieldReport, ShieldSettings } from '@fixora/shared-types';
import { create } from 'zustand';

import { invoke } from '../../lib/bridge.js';

/**
 * Code Shield's view state. The report itself is computed in main from real analyzer output
 * (`shield-service.ts`); this only holds the latest one and whether a run is in flight.
 *
 * `analyze` is deliberately last-write-wins by file: a debounced save and a file switch can race,
 * and showing file A's score under file B's name would be the exact class of wrong-but-plausible
 * number this feature must never produce.
 */
type ShieldState = {
  currentReport: CodeShieldReport | null;
  isAnalyzing: boolean;
  /** Which file the in-flight request is for, so a stale response can be discarded. */
  pendingFile: string | null;
  panelOpen: boolean;
  setPanelOpen: (open: boolean) => void;
  analyze: (filePath: string) => Promise<void>;
  clear: () => void;
};

export const useShieldStore = create<ShieldState>((set, get) => ({
  currentReport: null,
  isAnalyzing: false,
  pendingFile: null,
  panelOpen: false,

  setPanelOpen: (panelOpen) => {
    set({ panelOpen });
  },

  clear: () => {
    set({ currentReport: null, isAnalyzing: false, pendingFile: null });
  },

  analyze: async (filePath) => {
    set({ isAnalyzing: true, pendingFile: filePath });
    const result = await invoke('shield:analyze', { filePath });

    // The user moved on while this ran — drop it rather than label it with the wrong file.
    if (get().pendingFile !== filePath) return;

    set({
      isAnalyzing: false,
      pendingFile: null,
      currentReport: result.ok
        ? result.value
        : {
            score: null,
            critical: [],
            warnings: [],
            passed: [],
            prReadiness: 'not-ready',
            analyzedAt: Date.now(),
            file: filePath,
            error: result.error.message,
          },
    });
  },
}));

/** Code Shield's settings, mirrored from main (`shield-settings.ts`). Main stays the owner — this
 *  is a view of it, the same relationship `mcp-store.ts` has with the MCP switch. */
type ShieldSettingsState = ShieldSettings & {
  loaded: boolean;
  load: () => Promise<void>;
  save: (next: ShieldSettings) => Promise<void>;
};

export const useShieldSettingsStore = create<ShieldSettingsState>((set) => ({
  enabled: true,
  sensitivity: 'balanced',
  loaded: false,

  load: async () => {
    const result = await invoke('shield:getSettings', {});
    if (result.ok) set({ ...result.value, loaded: true });
  },

  save: async (next) => {
    const result = await invoke('shield:saveSettings', next);
    if (result.ok) set({ ...result.value, loaded: true });
  },
}));
