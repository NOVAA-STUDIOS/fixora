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
  /** Running tally, updated after every item — not just the final one — so the header can show
   * live counts while the queue is still going, not only once it finishes. */
  progress: BulkRepairSummary;
  summary: BulkRepairSummary | null;
  cancelRequested: boolean;
  start: (findings: readonly Finding[]) => Promise<void>;
  cancel: () => void;
  dismiss: () => void;
}

/** A macrotask yield (`setTimeout`, not a plain `await`) between items. Awaiting the IPC round trip
 * itself only yields to the microtask queue, which Chromium does not use to schedule a paint or
 * flush a pending click — a queue of findings that resolve fast (an immediate 'blocked'/'error', no
 * real model latency) could otherwise tick through hundreds of iterations back to back with no
 * macrotask boundary at all, which is what left the window unable to paint or field the Cancel
 * click ("Not Responding"), even though no single call was itself slow or blocking main. */
const yieldToEventLoop = (): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

export const useBulkRepairStore = create<BulkRepairState>((set, get) => ({
  status: 'idle',
  total: 0,
  index: 0,
  currentFindingId: null,
  progress: { repaired: 0, skipped: 0, failed: 0 },
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
      progress: { repaired: 0, skipped: 0, failed: 0 },
      summary: null,
      cancelRequested: false,
    });

    let repaired = 0;
    let failed = 0;
    let processed = 0;

    // One repair in flight at a time, by construction — each iteration awaits the previous one's
    // `run`/`applyRepair` to fully settle before the next starts. Raising this to run several
    // concurrently would mean several proposals racing the ONE active slot ai-store holds
    // (`activeFindingId`/`proposal`), which is a correctness hazard, not just a pacing one.
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

      // Progress after THIS item, not just at the end — and the macrotask yield that keeps the
      // window painting and the Cancel button clickable between items (see yieldToEventLoop above).
      set({ progress: { repaired, skipped: notRepairable, failed } });
      await yieldToEventLoop();
    }

    // Cancelled before the queue finished: whatever was never reached is a skip, not a failure —
    // the user stopped the run, Fixora didn't give up on those findings.
    const skipped = notRepairable + (queue.length - processed);
    set({
      status: 'done',
      currentFindingId: null,
      progress: { repaired, skipped, failed },
      summary: { repaired, skipped, failed },
    });
  },

  cancel: () => {
    set({ cancelRequested: true });
    // Aborts whichever single repair is currently in flight so the loop's `await` returns promptly
    // instead of waiting out a model call the user already asked to stop.
    void useAiStore.getState().cancel();
  },

  dismiss: () => {
    set({
      status: 'idle',
      total: 0,
      index: 0,
      currentFindingId: null,
      progress: { repaired: 0, skipped: 0, failed: 0 },
      summary: null,
    });
  },
}));
