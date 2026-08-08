import { isRepairAttemptable, repairStateFor, type Finding } from '@fixora/shared-types';
import { create } from 'zustand';

import { useAiStore } from '../../stores/ai-store.js';
import { evaluateApplyGate } from '../ai/apply-diagnostics.js';

/**
 * "Repair All Repairable" — a sequential queue built entirely on top of the existing single-repair
 * machinery in `ai-store.ts`. There is no new IPC channel here: each item runs the same `ai:run` /
 * `ai:applyRepair` round trip a manual Repair click makes, one at a time, so every gate (parser,
 * verifier, the secret gate) still runs per finding exactly as it does today — bulk changes nothing
 * about what's safe to apply, only how many times the button gets pressed.
 */

export type BulkRepairSummary = { repaired: number; skipped: number; failed: number };

interface BulkRepairState {
  status: 'idle' | 'running' | 'done';
  total: number;
  /** 1-based position of the item currently in flight, for "Repairing N/Total". */
  index: number;
  currentFindingId: string | null;
  summary: BulkRepairSummary | null;
  cancelRequested: boolean;
  start: (findings: readonly Finding[]) => Promise<void>;
  cancel: () => void;
  dismiss: () => void;
}

export const useBulkRepairStore = create<BulkRepairState>((set, get) => ({
  status: 'idle',
  total: 0,
  index: 0,
  currentFindingId: null,
  summary: null,
  cancelRequested: false,

  start: async (findings) => {
    // Not ai-repairable at all (manual-only, unsupported file, config issue) — never attempted, and
    // counted as skipped from the start rather than silently absent from the summary.
    const queue = findings.filter((f) => isRepairAttemptable(repairStateFor(f)));
    const notRepairable = findings.length - queue.length;

    set({
      status: 'running',
      total: queue.length,
      index: 0,
      currentFindingId: null,
      summary: null,
      cancelRequested: false,
    });

    let repaired = 0;
    let failed = 0;
    let processed = 0;

    for (const finding of queue) {
      if (get().cancelRequested) break;
      set({ index: processed + 1, currentFindingId: finding.id });

      await useAiStore.getState().run('repair', finding.id);
      processed += 1;
      if (get().cancelRequested) break;

      const { status, proposal } = useAiStore.getState();
      if (status === 'done' && proposal?.profile === 'repair' && evaluateApplyGate(proposal).enabled) {
        const applied = await useAiStore.getState().applyRepair();
        if (applied) repaired += 1;
        else failed += 1;
      } else {
        // 'blocked' (secret gate), 'error' (provider/verification failure), or a verified-but-
        // regressing proposal the apply gate refuses — all genuine repair failures, not skips.
        failed += 1;
      }
    }

    // Cancelled before the queue finished: whatever was never reached is a skip, not a failure —
    // the user stopped the run, Fixora didn't give up on those findings.
    const skipped = notRepairable + (queue.length - processed);
    set({ status: 'done', currentFindingId: null, summary: { repaired, skipped, failed } });
  },

  cancel: () => {
    set({ cancelRequested: true });
    // Aborts whichever single repair is currently in flight so the loop's `await` returns promptly
    // instead of waiting out a model call the user already asked to stop.
    void useAiStore.getState().cancel();
  },

  dismiss: () => {
    set({ status: 'idle', total: 0, index: 0, currentFindingId: null, summary: null });
  },
}));
