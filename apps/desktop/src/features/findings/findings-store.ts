import type { Finding, FindingsFilter, FindingsSummary } from '@fixora/shared-types';
import { create } from 'zustand';

import { invoke, subscribe } from '../../lib/bridge.js';

/**
 * The findings panel's state (M3). Findings live in SQLite (the store of record); this holds the
 * current *view* of them — the filtered slice the panel renders, the grouped summary, and the run
 * status. It never runs a tool: `run()` asks main to drive the isolated worker, findings stream back
 * as events, and the panel refreshes from the persisted store. This survives a restart because the
 * data does (DB §1).
 */

export type AnalysisStatus = 'idle' | 'running' | 'done' | 'error';

type FindingsState = {
  findings: Finding[];
  summary: FindingsSummary | null;
  status: AnalysisStatus;
  filter: FindingsFilter;
  error: string | null;

  /** Load the persisted findings + summary for the current workspace. */
  refresh: () => Promise<void>;
  /** Kick off an analysis run in the isolated worker. */
  run: () => Promise<void>;
  cancel: () => Promise<void>;
  setFilter: (filter: FindingsFilter) => Promise<void>;
  /** Subscribe to streamed findings + run-state; returns an unsubscribe. Call once on mount. */
  listen: () => () => void;
};

let refreshTimer: ReturnType<typeof setTimeout> | null = null;

export const useFindingsStore = create<FindingsState>((set, get) => ({
  findings: [],
  summary: null,
  status: 'idle',
  filter: {},
  error: null,

  refresh: async () => {
    const [list, summary] = await Promise.all([
      invoke('analysis:list', { filter: get().filter }),
      invoke('analysis:summary', {}),
    ]);
    set({
      findings: list.ok ? list.value.findings : [],
      summary: summary.ok ? summary.value : null,
    });
  },

  run: async () => {
    set({ status: 'running', error: null });
    const result = await invoke('analysis:run', {});
    if (!result.ok) set({ status: 'error', error: result.error.message });
  },

  cancel: async () => {
    await invoke('analysis:cancel', {});
    set({ status: 'idle' });
  },

  setFilter: async (filter) => {
    set({ filter });
    await get().refresh();
  },

  listen: () => {
    // A batch of findings arrived — coalesce refreshes so a burst of file results is one reload.
    const offFindings = subscribe('analysis:findingsAdded', () => {
      if (refreshTimer !== null) return;
      refreshTimer = setTimeout(() => {
        refreshTimer = null;
        void get().refresh();
      }, 200);
    });
    const offState = subscribe('analysis:state', (state) => {
      set({
        status: state.status,
        ...(state.summary !== undefined ? { summary: state.summary } : {}),
      });
      if (state.status === 'error') set({ error: state.message ?? 'Analysis failed.' });
      if (state.status === 'done') void get().refresh();
    });
    return () => {
      offFindings();
      offState();
    };
  },
}));
