import type { AnalysisWarning, Finding, FindingsFilter, FindingsSummary } from '@fixora/shared-types';
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
  /** Findings streamed in so far during a running analysis — proof of life on a long run. */
  findingsSoFar: number | null;
  /** Reliability warnings (NOV7-01): tools killed at their timeout, so the run was partial. */
  warnings: AnalysisWarning[] | null;
  filter: FindingsFilter;
  error: string | null;

  /** Findings the user hid this session (Ignore). Not persisted — a view convenience, not a decision. */
  ignoredIds: string[];
  /** The finding whose details are shown. Set by clicking a row. */
  selectedId: string | null;

  /** Load the persisted findings + summary for the current workspace. */
  refresh: () => Promise<void>;
  /** Kick off an analysis run in the isolated worker. */
  run: () => Promise<void>;
  cancel: () => Promise<void>;
  setFilter: (filter: FindingsFilter) => Promise<void>;
  /** Show this finding's details. */
  select: (id: string | null) => void;
  /** Hide a finding from the list for this session. */
  ignore: (id: string) => void;
  /** Un-hide everything ignored this session. */
  showIgnored: () => void;
  /** Subscribe to streamed findings + run-state; returns an unsubscribe. Call once on mount. */
  listen: () => () => void;
};

/** Buffered `analysis:findingsAdded` payloads, flushed into the store at most every `FLUSH_MS` —
 * not re-queried from the DB (`analysis:list`) on each one, because main no longer writes findings
 * per batch (analysis-service.ts): the DB has nothing until the run's single write in `onDone`, so
 * re-reading it mid-run would show nothing at all until the end regardless of the interval. */
let pendingFindings: Finding[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
const FLUSH_MS = 500;

export const useFindingsStore = create<FindingsState>((set, get) => ({
  findings: [],
  summary: null,
  status: 'idle',
  findingsSoFar: null,
  warnings: null,
  filter: {},
  error: null,
  ignoredIds: [],
  selectedId: null,

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
    // A fresh run's findings replace the previous run's — otherwise the first buffered batch would
    // land on top of stale rows still shown from before this run started.
    pendingFindings = [];
    set({ status: 'running', error: null, findingsSoFar: null, warnings: null, findings: [] });
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

  select: (id) => {
    set({ selectedId: id });
  },

  ignore: (id) => {
    set((s) => (s.ignoredIds.includes(id) ? s : { ignoredIds: [...s.ignoredIds, id] }));
  },

  showIgnored: () => {
    set({ ignoredIds: [] });
  },

  listen: () => {
    const flush = (): void => {
      flushTimer = null;
      if (pendingFindings.length === 0) return;
      const toAdd = pendingFindings;
      pendingFindings = [];
      set((s) => ({ findings: [...s.findings, ...toAdd] }));
    };

    // Buffered, not applied one push at a time: a burst of file results becomes at most one
    // store update (and one downstream re-render/re-sort) every FLUSH_MS, not one per batch.
    const offFindings = subscribe('analysis:findingsAdded', ({ findings }) => {
      pendingFindings.push(...findings);
      flushTimer ??= setTimeout(flush, FLUSH_MS);
    });
    const offState = subscribe('analysis:state', (state) => {
      set({
        status: state.status,
        ...(state.summary !== undefined ? { summary: state.summary } : {}),
        ...(state.findingsSoFar !== undefined ? { findingsSoFar: state.findingsSoFar } : {}),
        ...(state.warnings !== undefined ? { warnings: state.warnings } : {}),
      });
      if (state.status === 'error') set({ error: state.message ?? 'Analysis failed.' });
      if (state.status === 'done') {
        // Any buffered-but-not-yet-flushed findings must land before the authoritative reload
        // below, or `refresh()`'s DB read (now populated by the run's single write) would appear
        // to arrive before them — same data, wrong order.
        if (flushTimer !== null) {
          clearTimeout(flushTimer);
          flush();
        }
        void get().refresh();
      }
    });
    return () => {
      offFindings();
      offState();
      if (flushTimer !== null) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
    };
  },
}));
