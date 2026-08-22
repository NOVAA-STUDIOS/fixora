import { isRepairAttemptable, repairStateFor, type Category, type Finding } from '@fixora/shared-types';
import { create } from 'zustand';

import { invoke } from '../../lib/bridge.js';
import { basename } from '../../lib/path.js';
import { useAiStore } from '../../stores/ai-store.js';
import { evaluateApplyGate } from '../ai/apply-diagnostics.js';
import { assessForceApplyRisk, type ForceApplyRisk } from '../ai/force-apply-risk.js';
import { detectHarmfulFix, isLowConfidence } from '../ai/repair-safety.js';
import { useWorkspaceStore } from '../workspace/workspace-store.js';

import { useFindingsStore } from './findings-store.js';

/**
 * "Repair All Repairable" — a sequential queue built entirely on top of the existing single-repair
 * machinery in `ai-store.ts`. There is no new IPC channel here: each item runs the same `ai:run` /
 * `ai:applyRepair` round trip a manual Repair click makes, one at a time, so every gate (parser,
 * verifier, the secret gate) still runs per finding exactly as it does today — bulk changes nothing
 * about what's safe to apply, only how many times the button gets pressed.
 *
 * Retrying an unresolved fix up to 3 attempts, re-verifying against the real analyzers each time —
 * including confirming a complexity finding's metric actually dropped — is NOT built here: it
 * already exists in `ai-service.ts`'s `VERIFY_RETRY_LIMIT` (= 3) re-ask loop, which runs on EVERY
 * repair attempt (bulk or single-click) before a proposal is ever returned. `applyRepair()` only
 * ever sees the last attempt's verdict, already the best of up to 3 tries. Building a second,
 * outer retry loop here would re-run an already-exhausted repair against the same model with no new
 * information — not a fix, just wasted calls.
 *
 * `manual-only` findings (no deterministic or rule-specific AI fix — "AI Repair Unavailable")
 * ARE included, via `ai:run`'s `allowManual` opt-in: attempted through this exact same verified/
 * gated pipeline, not a bypass of it. The single-click Repair button never sets that flag, so a
 * manual-only finding is still refused there exactly as before — this is bulk-only, and every
 * attempt is still a reviewable, verified diff before it's ever written.
 */

export type BulkRepairSummary = {
  repaired: number;
  skipped: number;
  failed: number;
  /** Of `failed`, how many were specifically "the model tried (up to 3x) and never resolved it" —
   * as opposed to blocked, a transport error, or a verified-but-regressing patch. These are the
   * ones worth surfacing as "needs manual fix" rather than lumping into a bare failure count. */
  needsManualFix: { findingId: string; ruleId: string; reason: string }[];
};

/** Per-finding state for the grouped-repair panel (grouped-repair-panel.tsx) — the aggregate
 * `progress` above answers "how's the whole queue doing", this answers "what's happening to THIS
 * finding right now", which a per-group card needs to render each row's ✓ / ⟳ / ○ / ✕. */
export type FindingRepairStatus = 'pending' | 'fixing' | 'done' | 'failed' | 'needs-review';

/** Why a repair stopped at `needs-review` instead of auto-applying — surfaced by the panel as the
 *  "may be risky" warning card. Never blocks the queue itself; the user resolves it per-finding. */
export interface FindingReviewFlag {
  readonly harmfulReasons: readonly string[];
  readonly lowConfidence: boolean;
}

interface BulkRepairState {
  status: 'idle' | 'running' | 'done';
  total: number;
  /** 1-based position of the item currently in flight, for "Repairing N/Total". */
  index: number;
  currentFindingId: string | null;
  /** "filename.ts — rule-id", for "Repairing X of Y — filename.ts" — the ID alone told the user
   * a number, not what was actually happening. */
  currentFindingLabel: string | null;
  /** Remaining queue length × the average time each completed item has taken so far. `null` until
   * the first item finishes — a single sample makes a weak estimate, but no sample makes none. */
  etaMs: number | null;
  /** Running tally, updated after every item — not just the final one — so the header can show
   * live counts while the queue is still going, not only once it finishes. */
  progress: BulkRepairSummary;
  summary: BulkRepairSummary | null;
  cancelRequested: boolean;
  /** Keyed by finding id, for whichever findings the most recent `start` call queued. */
  findingStatus: Record<string, FindingRepairStatus>;
  /** Keyed by finding id — only present for findings currently at `needs-review`. */
  reviewFlags: Record<string, FindingReviewFlag>;
  /** Keyed by finding id — set for ANY repair (applied or held for review) whose rationale reads
   *  as uncertain. Purely advisory (never blocks), so it is tracked separately from `reviewFlags`. */
  lowConfidenceIds: Record<string, boolean>;
  /** Cascading Problem Detection: the queue is paused waiting on this finding's Fix Anyway/Skip
   *  decision — null the rest of the time. Set from the verifier's own `newFindings` report
   *  (`ForceApplyRisk`), never a second AI guess. */
  cascadingPause: { findingId: string; risk: ForceApplyRisk } | null;
  /** Resolves the current `cascadingPause` and lets the queue continue. No-op if nothing is paused. */
  resolveCascading: (forceApply: boolean) => void;
  /** Applies a `needs-review` finding's already-generated proposal after the user reviewed it —
   *  does not regenerate, so what gets written is exactly what was shown. */
  applyReviewed: (findingId: string) => Promise<void>;
  /** Dismisses a `needs-review` finding without applying it. */
  skipReviewed: (findingId: string) => void;
  start: (findings: readonly Finding[]) => Promise<void>;
  /** Repairs only the findings in one category — grouped-repair-panel's per-group "Fix All". */
  groupedRepair: (category: Category, findings: readonly Finding[]) => Promise<void>;
  /** Repairs an arbitrary, caller-chosen subset — the primitive `groupedRepair` itself is built on. */
  repairGroup: (findings: readonly Finding[]) => Promise<void>;
  cancel: () => void;
  dismiss: () => void;
}

/** A macrotask yield (`setTimeout`, not a plain `await`) between items. Awaiting the IPC round trip
 * itself only yields to the microtask queue, which Chromium does not use to schedule a paint or
 * flush a pending click — a queue of findings that resolve fast (an immediate 'blocked'/'error', no
 * real model latency) could otherwise tick through hundreds of iterations back to back with no
 * macrotask boundary at all, which is what left the window unable to paint or field the Cancel
 * click ("Not Responding"), even though no single call was itself slow or blocking main. */
function withoutKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  return Object.fromEntries(Object.entries(record).filter(([k]) => k !== key));
}

/** The pending decision's resolver, held outside the store: a function is not state to persist or
 *  diff, just the one thing `resolveCascading` needs to reach to unblock the loop's `await`. */
let cascadingResolver: ((forceApply: boolean) => void) | null = null;

function waitForCascadingDecision(findingId: string, risk: ForceApplyRisk): Promise<boolean> {
  return new Promise((resolve) => {
    cascadingResolver = resolve;
    useBulkRepairStore.setState({ cascadingPause: { findingId, risk } });
  });
}

const yieldToEventLoop = (): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

export const useBulkRepairStore = create<BulkRepairState>((set, get) => ({
  status: 'idle',
  total: 0,
  index: 0,
  currentFindingId: null,
  currentFindingLabel: null,
  etaMs: null,
  progress: { repaired: 0, skipped: 0, failed: 0, needsManualFix: [] },
  summary: null,
  cancelRequested: false,
  findingStatus: {},
  reviewFlags: {},
  lowConfidenceIds: {},
  cascadingPause: null,

  resolveCascading: (forceApply) => {
    const resolve = cascadingResolver;
    cascadingResolver = null;
    set({ cascadingPause: null });
    resolve?.(forceApply);
  },

  applyReviewed: async (findingId) => {
    // Re-runs rather than reusing a held proposal: `ai-store` holds exactly one active proposal at
    // a time, already overwritten by whatever the queue processed after this finding. A fresh
    // grounded run is the only way to get a proposal to apply, and the user reviewing the flagged
    // diff before clicking "Review & Apply" is the human-in-the-loop step this whole gate exists for.
    await useAiStore.getState().run('repair', findingId);
    const { status, proposal } = useAiStore.getState();
    let applied = false;
    if (status === 'done' && proposal?.profile === 'repair' && evaluateApplyGate(proposal).enabled) {
      applied = await useAiStore.getState().applyRepair();
    }
    set((s) => ({
      reviewFlags: withoutKey(s.reviewFlags, findingId),
      findingStatus: { ...s.findingStatus, [findingId]: applied ? 'done' : 'failed' },
    }));
  },

  skipReviewed: (findingId) => {
    set((s) => ({
      reviewFlags: withoutKey(s.reviewFlags, findingId),
      findingStatus: { ...s.findingStatus, [findingId]: 'failed' },
    }));
  },

  start: async (findings) => {
    // Truly un-attemptable (unsupported file type, a config/environment issue) — never attempted,
    // and counted as skipped from the start rather than silently absent from the summary.
    // `manual-only` is NOT excluded here — it's attempted with `allowManual`, below.
    const queue = findings.filter((f) => {
      const state = repairStateFor(f);
      return isRepairAttemptable(state) || state === 'manual-only';
    });
    const notRepairable = findings.length - queue.length;

    set({
      status: 'running',
      total: queue.length,
      index: 0,
      currentFindingId: null,
      currentFindingLabel: null,
      etaMs: null,
      progress: { repaired: 0, skipped: 0, failed: 0, needsManualFix: [] },
      summary: null,
      cancelRequested: false,
      findingStatus: Object.fromEntries(queue.map((f) => [f.id, 'pending'])),
      reviewFlags: {},
      cascadingPause: null,
    });

    let repaired = 0;
    let failed = 0;
    let processed = 0;
    let totalElapsedMs = 0;
    const needsManualFix: BulkRepairSummary['needsManualFix'] = [];

    // Buffers the history writes every `applyRepair()` below would otherwise commit one at a time —
    // `ai:bulkRepairFlush` (after the loop) replays them all in a single `driver.transaction()`.
    // `workspaceId` is null only if the workspace closed between the button click and here, in which
    // case there is nothing to buffer or flush and the loop below still runs unbuffered (main's
    // default, everyday path) — never silently skipped.
    const workspaceId = useWorkspaceStore.getState().workspace?.id ?? null;
    if (workspaceId !== null) await invoke('ai:bulkRepairStart', { workspaceId });

    // One repair in flight at a time, by construction — each iteration awaits the previous one's
    // `run`/`applyRepair` to fully settle before the next starts. Raising this to run several
    // concurrently would mean several proposals racing the ONE active slot ai-store holds
    // (`activeFindingId`/`proposal`), which is a correctness hazard, not just a pacing one.
    for (const finding of queue) {
      if (get().cancelRequested) break;
      set((s) => ({
        index: processed + 1,
        currentFindingId: finding.id,
        currentFindingLabel: `${basename(finding.location.file)} — ${finding.ruleId}`,
        findingStatus: { ...s.findingStatus, [finding.id]: 'fixing' },
      }));
      const itemStartedAt = Date.now();

      const allowManual = repairStateFor(finding) === 'manual-only';
      await useAiStore.getState().run('repair', finding.id, undefined, { allowManual });
      processed += 1;
      if (get().cancelRequested) break;

      const { status, proposal } = useAiStore.getState();
      let itemApplied = false;
      let needsReview = false;
      if (status === 'done' && proposal?.profile === 'repair' && evaluateApplyGate(proposal).enabled) {
        const harmful = detectHarmfulFix(proposal.originalCode, proposal.repairedCode);
        const lowConfidence = isLowConfidence(proposal.rationale);
        if (lowConfidence) {
          set((s) => ({ lowConfidenceIds: { ...s.lowConfidenceIds, [finding.id]: true } }));
        }
        if (harmful.harmful) {
          // Verified, but the diff shape itself is the kind that's cheap to apply and expensive to
          // apply wrong — held for the user to review rather than auto-applied. Low confidence alone
          // never blocks (per spec) — it rides along as an advisory flag only when harmful already did.
          needsReview = true;
          set((s) => ({
            reviewFlags: {
              ...s.reviewFlags,
              [finding.id]: { harmfulReasons: harmful.reasons, lowConfidence },
            },
          }));
        } else {
          const applied = await useAiStore.getState().applyRepair();
          if (applied) repaired += 1;
          else failed += 1;
          itemApplied = applied;
        }
      } else if (status === 'done' && proposal?.profile === 'repair') {
        // Verification itself found new problems (or the patch does not even parse) — Cascading
        // Problem Detection. The queue pauses HERE, on this exact finding, and waits for the
        // user's Fix Anyway/Skip before touching anything else — the same real analyzer signal
        // `force-apply-risk.ts` already surfaces for the single-repair panel, not a second guess.
        // Non-null: `proposal` is a repair proposal, and `assessForceApplyRisk` only returns null
        // for a null proposal.
        const risk = assessForceApplyRisk(proposal) as ForceApplyRisk;
        const forceApply = await waitForCascadingDecision(finding.id, risk);
        if (forceApply) {
          const applied = await useAiStore.getState().applyRepair({ forced: true });
          if (applied) repaired += 1;
          else failed += 1;
          itemApplied = applied;
        } else {
          failed += 1;
          if (proposal.verification.verdict === 'unresolved') {
            needsManualFix.push({
              findingId: finding.id,
              ruleId: finding.ruleId,
              reason:
                proposal.verification.note ??
                'Fixora tried and verified up to 3 attempts, but none resolved this finding.',
            });
          }
        }
      } else {
        // 'blocked' (secret gate) or 'error' (provider/verification transport failure) — nothing
        // to show a diff for, so these count as failed immediately rather than pausing the queue.
        failed += 1;
      }

      // A simple running average, not a per-item sample list: repairs vary too much (an instant
      // 'blocked' vs. a multi-attempt model round trip) for a fancier estimate to earn its keep,
      // and the average already improves every item without needing history kept around for it.
      totalElapsedMs += Date.now() - itemStartedAt;
      const remaining = queue.length - processed;
      const etaMs = remaining > 0 ? (totalElapsedMs / processed) * remaining : 0;

      // Progress after THIS item, not just at the end — and the macrotask yield that keeps the
      // window painting and the Cancel button clickable between items (see yieldToEventLoop above).
      set((s) => ({
        progress: { repaired, skipped: notRepairable, failed, needsManualFix: [...needsManualFix] },
        etaMs,
        findingStatus: {
          ...s.findingStatus,
          [finding.id]: needsReview ? 'needs-review' : itemApplied ? 'done' : 'failed',
        },
      }));
      await yieldToEventLoop();
    }

    // Unconditional, even on cancel: whatever DID get buffered before the user cancelled is a real,
    // already-completed repair and must still land — cancelling the queue must not also discard the
    // history of what already happened.
    if (workspaceId !== null) await invoke('ai:bulkRepairFlush', { workspaceId });

    // Cancelled before the queue finished: whatever was never reached is a skip, not a failure —
    // the user stopped the run, Fixora didn't give up on those findings.
    const skipped = notRepairable + (queue.length - processed);
    set({
      status: 'done',
      currentFindingId: null,
      currentFindingLabel: null,
      etaMs: null,
      progress: { repaired, skipped, failed, needsManualFix },
      summary: { repaired, skipped, failed, needsManualFix },
    });

    // Applied writes never update the findings table themselves (only the file on disk + history) —
    // a fresh analysis is what makes the Problems panel's counts and list honest again. Only worth
    // it if something actually changed; a run that repaired nothing left nothing to re-check.
    if (repaired > 0) void useFindingsStore.getState().run();
  },

  // Both below are thin filters over `start` — they queue a subset, then run the exact same
  // gated/verified pipeline `start` already runs for every item. No separate repair path exists.
  repairGroup: async (findings) => {
    await get().start(findings);
  },

  groupedRepair: async (category, findings) => {
    await get().repairGroup(findings.filter((f) => f.category === category));
  },

  cancel: () => {
    set({ cancelRequested: true });
    // A cascading pause is an `await` on user input, not on the model — cancel must resolve it
    // (as a skip) itself, or Cancel would sit inert forever behind an open warning dialog.
    get().resolveCascading(false);
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
      progress: { repaired: 0, skipped: 0, failed: 0, needsManualFix: [] },
      summary: null,
      findingStatus: {},
      reviewFlags: {},
      lowConfidenceIds: {},
      cascadingPause: null,
    });
  },
}));
