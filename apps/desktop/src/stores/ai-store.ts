import { FOLLOWUP_MAX_MESSAGES } from '@fixora/shared-types';
import type {
  AiFailure,
  AiConfig,
  AiRunStage,
  RepairMode,
  AiModelList,
  AiProposal,
  GateMatchInfo,
  TaskProfile,
} from '@fixora/shared-types';
import { create } from 'zustand';

import {
  evaluateApplyGate,
  rootCauseOf,
  type ApplyAttempt,
} from '../features/ai/apply-diagnostics.js';
import { refreshModelText } from '../features/editor/models.js';
import { useFeedbackStore } from '../features/feedback/feedback-store.js';
import { useHistoryStore } from '../features/history/history-store.js';
import { notify } from '../features/notifications/notify.js';
import { invoke, subscribe } from '../lib/bridge.js';
import { basename } from '../lib/path.js';

import { DAILY_LIMIT, useLicenseStore } from './license-store.js';

/**
 * The renderer's AI state (M5, BYOK). It holds the *config the renderer is allowed to know* (configured,
 * model, a key hint — never the key) and the state of the one active run: streamed prose, the resulting
 * proposal, or a typed failure. The key itself is write-only from here: `setKey` sends it to main, and
 * nothing ever reads it back.
 */

export type AiRunStatus = 'idle' | 'running' | 'blocked' | 'error' | 'done';

type AiState = {
  config: AiConfig | null;
  /** The live OpenRouter catalogue for the model picker; null until first loaded. */
  models: AiModelList | null;
  loadModels: (refresh?: boolean) => Promise<void>;
  /** Dismiss the "we moved you to a different model" notice after the user has read it. */
  dismissMigrationNotice: () => void;

  loadConfig: () => Promise<void>;
  setModel: (model: string) => Promise<void>;

  status: AiRunStatus;
  /** Which phase a running repair is in, for the progress label. Null when not running. */
  stage: AiRunStage | null;
  activeFindingId: string | null;
  activeProfile: TaskProfile | null;
  /** The mode the active run used, so Retry replays it rather than falling back to the default. */
  activeMode: RepairMode | null;
  streamText: string;
  proposal: AiProposal | null;
  blocked: readonly GateMatchInfo[] | null;
  errorMessage: string | null;
  /** True when the failure could plausibly succeed on a retry (quota reset, provider blip). Mirrors
   *  Proceed's `retryable` (P2.2.1) so the two panels behave consistently for the same failure. */
  retryable: boolean;
  /**
   * The classified provider failure behind `errorMessage`, when the run produced one.
   *
   * Null for failures that never reached the classifier — a renderer↔main transport drop, a workspace
   * that closed. Those still set `errorMessage`, so the panel always has something to say; the card
   * simply renders in its reduced form. `errorMessage` staying required is what guarantees the panel
   * is never empty.
   */
  failure: AiFailure | null;
  /** The last apply attempt, in full. Rendered by the diagnostics panel; never persisted. */
  lastApplyAttempt: ApplyAttempt | null;

  run: (
    profile: TaskProfile,
    findingId: string,
    mode?: RepairMode,
    options?: { allowManual?: boolean },
  ) => Promise<void>;
  /** Re-run the last attempted profile/finding — Proceed's Retry, mirrored for Repair/Explain/Test. */
  retry: () => Promise<void>;
  cancel: () => Promise<void>;
  /**
   * Apply the current repair proposal to the file on disk. Returns true on success.
   *
   * `forced` marks a deliberate override of a FAILED verification (Force Apply). It changes nothing
   * about what is sent or what main enforces — the staleness check, range validation and path guard
   * all still run — it only makes the override auditable.
   */
  applyRepair: (options?: { forced?: boolean }) => Promise<boolean>;
  dismiss: () => void;
  listen: () => () => void;

  /** Follow-up Q&A about the current explanation, oldest first. Cleared on every new run. */
  followUps: { role: 'user' | 'assistant'; content: string }[];
  /** True while an answer is streaming. */
  followUpPending: boolean;
  /** Asks a follow-up. No-op when there is no explanation to follow up on, or the cap is reached. */
  askFollowUp: (question: string) => Promise<void>;
};

/**
 * Invalidation token for in-flight runs.
 *
 * `run()` awaits an IPC round-trip that routinely takes tens of seconds (a provider call, plus
 * verification). Everything it sets *after* that await used to be written unconditionally, so a
 * `dismiss()` or `cancel()` that happened while the request was in flight was silently undone the
 * moment the stale promise resolved — it re-set `status: 'error'` and the panel the user had just
 * closed came straight back. That is the reported "Dismiss does not close the error panel".
 *
 * Bumping this token supersedes any run still in flight: the run checks it before every write and
 * drops its result if it is no longer the current one. Same guard shape `use-splash.ts` already uses
 * for superseded initialization attempts.
 */
let runToken = 0;

/**
 * The state reset that a provider change implies — the renderer half of "changing the key behaves
 * like a fresh launch".
 *
 * Every field here describes the PREVIOUS credential: the quota verdict, the classified failure, the
 * blocked-secret list, a proposal generated by the old key. Keeping any of them after a switch is
 * what made a valid new key still read as "AI Repair Unavailable — Quota exceeded".
 *
 * Bumping `runToken` is part of the reset, not an extra: a run still in flight was issued against
 * the old key, and without superseding it its late result would land after the switch and re-assert
 * the very state this clears.
 */
function providerStateChanged(): {
  status: AiRunStatus;
  stage: null;
  streamText: string;
  proposal: null;
  blocked: null;
  errorMessage: null;
  retryable: boolean;
  failure: null;
  lastApplyAttempt: null;
} {
  runToken += 1;
  return {
    status: 'idle',
    stage: null,
    streamText: '',
    proposal: null,
    blocked: null,
    errorMessage: null,
    retryable: false,
    failure: null,
    lastApplyAttempt: null,
  };
}

/**
 * Re-run the request the OLD credential refused for quota, once a new one is in place.
 *
 * Deliberately narrow. `quota-exceeded` is the one failure a new key or model plainly resolves — the
 * work was valid, the allowance was not — so replaying it turns "paste key, then go and find your
 * finding again" into the repair simply arriving. Every other category is excluded on purpose: an
 * `invalid-api-key` may still be invalid, a `network-offline` is unrelated to the key, and an
 * `invalid-response` would just spend the new allowance repeating a model's mistake.
 *
 * Replays only what the user already asked for — same profile, same finding, same mode — so this
 * can never start work they did not request. `run()`'s own token guard makes a later manual action
 * supersede it.
 */
function resumeAfterQuota(
  previous: { failure: AiFailure | null; activeProfile: TaskProfile | null; activeFindingId: string | null; activeMode: RepairMode | null },
  get: () => AiState,
): Promise<void> {
  if (previous.failure?.category !== 'quota-exceeded') return Promise.resolve();
  const { activeProfile, activeFindingId, activeMode } = previous;
  if (activeProfile === null || activeFindingId === null) return Promise.resolve();
  return get().run(activeProfile, activeFindingId, activeMode ?? undefined);
}

export const useAiStore = create<AiState>((set, get) => ({
  config: null,
  models: null,
  lastApplyAttempt: null,
  stage: null,
  followUps: [],
  followUpPending: false,

  askFollowUp: async (question) => {
    const trimmed = question.trim();
    const { proposal, activeFindingId, followUps, followUpPending } = get();
    if (trimmed === '' || followUpPending) return;
    if (proposal?.profile !== 'explain' || activeFindingId === null) return;
    // The cap counts BOTH sides of the conversation, so ten messages is five exchanges. Enforced
    // here rather than only in the UI, since this is the thing that spends tokens.
    if (followUps.length >= FOLLOWUP_MAX_MESSAGES) return;

    // Optimistic: the question appears immediately, so the thread reads as a conversation rather
    // than as a form that goes blank while it thinks.
    set({ followUps: [...followUps, { role: 'user', content: trimmed }], followUpPending: true });

    const result = await invoke('ai:run', {
      profile: 'explain',
      findingId: activeFindingId,
      followUp: {
        question: trimmed,
        // The explanation this thread hangs off, verbatim — never a summary. Main re-sends the
        // real file and finding alongside it, so each answer is re-grounded in the actual code.
        priorExplanation: proposal.explanation,
        history: followUps,
      },
    });

    if (!result.ok || result.value.status !== 'ok' || result.value.proposal.profile !== 'explain') {
      const message =
        !result.ok
          ? result.error.message
          : result.value.status === 'error'
            ? result.value.message
            : 'That question could not be answered.';
      set((s) => ({
        followUpPending: false,
        followUps: [...s.followUps, { role: 'assistant', content: message }],
      }));
      return;
    }

    const answer = result.value.proposal.explanation;
    set((s) => ({
      followUpPending: false,
      followUps: [...s.followUps, { role: 'assistant', content: answer }],
    }));
  },

  loadModels: async (refresh = false) => {
    const result = await invoke('ai:listModels', refresh ? { refresh: true } : {});
    if (result.ok) set({ models: result.value });
  },

  dismissMigrationNotice: () => {
    set((s) => (s.config === null ? s : { config: { ...s.config, migratedFrom: null } }));
  },

  loadConfig: async () => {
    const result = await invoke('ai:getConfig', {});
    if (result.ok) set({ config: result.value });
  },

  /**
   * Saving a key must leave the panel exactly as a fresh launch would.
   *
   * The failure state is about the OLD credential — "Quota exceeded", "invalid API key" — and it
   * survived the save, so a user who pasted a working key was still told their allowance was gone.
   * `providerStateChanged` clears the run state and supersedes anything still in flight, so a late
   * result from the previous key cannot land afterwards and re-assert the stale verdict.
   */
  setModel: async (model) => {
    const previous = get();
    const result = await invoke('ai:setModel', { model });
    // A different model has its own allowance and its own capabilities, so the previous model's
    // quota verdict and failure card must not carry over to it.
    if (!result.ok) return;
    set({ config: result.value, ...providerStateChanged() });
    void resumeAfterQuota(previous, get);
  },

  status: 'idle',
  activeFindingId: null,
  activeProfile: null,
  activeMode: null,
  streamText: '',
  proposal: null,
  blocked: null,
  errorMessage: null,
  retryable: false,
  failure: null,

  run: async (profile, findingId, mode, options) => {
    // The free-tier gate only applies to repairs, never to plain analysis review — and it must run
    // before anything else claims the token below, or a blocked attempt still marks itself active.
    if (profile === 'repair') {
      const license = useLicenseStore.getState();
      if (!license.canRepair()) {
        license.setUpgradeDialogOpen(true);
        // OS-level too: the limit can be reached by a bulk run the user walked away from, and
        // returning to a silently stalled queue is worse than being told why it stopped.
        notify('error', 'Repair limit reached', 'Upgrade or wait for your window to reset.', {
          alsoNotifyOs: true,
          urgency: 'critical',
        });
        return;
      }
      license.incrementRepair();

      // Warn once, on the way past the second-to-last repair — early enough to be actionable and
      // only on the exact crossing, so a long session is not nagged every single repair.
      const { plan, repairsToday } = useLicenseStore.getState();
      const remaining = DAILY_LIMIT[plan] - repairsToday;
      if (remaining === 2) {
        notify('warning', '⚠️ 2 repairs left this window', 'Your limit resets every 3 hours.');
      }
    }

    // Claim this run. Any earlier one still awaiting its round-trip is now stale and will discard
    // its result rather than overwrite ours.
    const myToken = (runToken += 1);
    const superseded = (): boolean => myToken !== runToken;
    set({
      status: 'running',
      stage: 'preparing',
      activeFindingId: findingId,
      activeProfile: profile,
      activeMode: mode ?? null,
      streamText: '',
      // A new run ends the previous explanation thread: follow-ups about an explanation that is no
      // longer on screen would be answering questions against code the user has moved on from.
      followUps: [],
      followUpPending: false,
      proposal: null,
      blocked: null,
      errorMessage: null,
      retryable: false,
      failure: null,
    });

    /**
     * `invoke` REJECTS — it is not a Result-only channel.
     *
     * `ipcRenderer.invoke` rejects when main has no handler registered for the channel or the
     * handler itself throws, and the preload throws outright for an unknown channel. Every caller
     * here is fire-and-forget (`void runAi(...)` in `problem-details.tsx`), so an unguarded
     * rejection became an uncaught promise rejection in the console and left `status` stuck on
     * `running` — a spinner with no way out. Caught and routed into the same typed error state a
     * transport failure already uses; nothing is swallowed.
     */
    let result: Awaited<ReturnType<typeof invoke<'ai:run'>>>;
    try {
      result = await invoke('ai:run', {
        profile,
        findingId,
        ...(mode === undefined ? {} : { mode }),
        ...(options?.allowManual === true ? { allowManual: true } : {}),
      });
    } catch (error) {
      if (superseded()) return;
      set({
        status: 'error',
        stage: null,
        errorMessage:
          error instanceof Error && error.message !== ''
            ? error.message
            : 'Fixora could not reach its own background process to run this repair.',
        retryable: true,
        failure: null,
      });
      return;
    }
    // Dismissed, cancelled, or replaced by a newer run while this one was in flight. The user has
    // already moved on; writing this result would resurrect a panel they closed.
    if (superseded()) return;
    if (!result.ok) {
      // Transport failure between renderer and main — a UI-layer failure, retryable by nature (same
      // treatment Proceed gives the equivalent case).
      // A renderer↔main transport failure. Genuinely Fixora's layer, and the only place in this
      // store that says so — everything below is the provider's or the user's configuration.
      set({
        status: 'error',
        stage: null,
        errorMessage: result.error.message,
        retryable: true,
        failure: null,
      });
      return;
    }
    const response = result.value;
    if (response.status === 'ok') {
      set({ status: 'done', stage: null, proposal: response.proposal });
    } else if (response.status === 'blocked') {
      set({ status: 'blocked', stage: null, blocked: response.matches });
    } else {
      set({
        status: 'error',
        stage: null,
        errorMessage: response.message,
        retryable: response.retryable === true,
        failure: response.failure ?? null,
      });
    }
  },

  retry: async () => {
    const { activeProfile, activeFindingId, activeMode, run } = get();
    if (activeProfile === null || activeFindingId === null) return;
    // Replays the SAME mode. Retrying a scoped repair as a whole-file one would widen the blast
    // radius behind a button that only says "Retry".
    await run(activeProfile, activeFindingId, activeMode ?? undefined);
  },

  cancel: async () => {
    // Supersede first, then tell main to abort: the abort makes the in-flight `run()` resolve, and
    // without the bump it would immediately write its terminal state over the idle we just set.
    runToken += 1;
    set({ status: 'idle', stage: null });
    // The panel is already idle; a failure to deliver the abort is not something to surface or to
    // let escape as an unhandled rejection. Logged, never silenced.
    try {
      await invoke('ai:cancel', {});
    } catch (error) {
      console.error('[ai] cancel could not be delivered', error);
    }
  },

  applyRepair: async (options) => {
    const { proposal, activeFindingId } = get();
    if (proposal?.profile !== 'repair') return false;

    // Evaluated on EVERY apply, forced or not: the attempt record must always carry the gate's
    // verdict, so a forced write is auditable against what verification actually said at the time.
    const gate = evaluateApplyGate(proposal);
    const forced = options?.forced === true;
    const request = {
      file: proposal.target.file,
      startLine: proposal.target.startLine,
      endLine: proposal.target.endLine,
      code: proposal.repairedCode,
      expectedOriginal: proposal.originalCode,
      historyId: proposal.historyId,
      ...(forced ? { forced: true } : {}),
    };
    // TEMP-DIAGNOSTIC BUG-002 renderer-pre-ipc (Q3 file-corruption incident — remove after root
    // cause). The earliest point `code`/`expectedOriginal` exist as the request that will cross
    // to main — before `invoke()`, before Electron's own IPC serialization. Closes the last
    // uninstrumented gap: every other Q3 marker is main-side, so none could tell a renderer-side
    // corruption apart from one introduced by IPC transport or by main itself.
    if (request.file.includes('proceed-diag')) {
      const codeNul = request.code.split(String.fromCharCode(0)).length - 1;
      const origNul = request.expectedOriginal.split(String.fromCharCode(0)).length - 1;
      console.error('[Q3-DIAG] ai-store: applyRepair request before invoke', {
        file: request.file,
        codeByteLength: new TextEncoder().encode(request.code).length,
        codeNulCount: codeNul,
        codePreview: request.code.slice(0, 100),
        expectedOriginalByteLength: new TextEncoder().encode(request.expectedOriginal).length,
        expectedOriginalNulCount: origNul,
        expectedOriginalPreview: request.expectedOriginal.slice(0, 100),
      });
    }
    const startedAt = Date.now();
    const attempt: ApplyAttempt = {
      at: startedAt,
      // From the verification diagnostics, which is where main records it. Recorded on every attempt
      // so the diagnostics panel can prove severity never entered the apply decision.
      findingSeverity: (proposal.verification.diagnostics?.targetSeverity ??
        'unknown') as ApplyAttempt['findingSeverity'],
      findingId: activeFindingId,
      gate,
      request,
      response: null,
      transportError: null,
      durationMs: null,
    };

    // Record a gate refusal as an attempt too. Otherwise a disabled-button case leaves no trace and
    // is indistinguishable from "the click did nothing".
    //
    // `forced` is the ONE thing that passes this guard, and only this guard: it is the user's
    // explicit, confirmed override of the VERIFICATION gate, taken after being shown what failed and
    // what may happen. Without the exemption here, Force Apply was inert — the dialog resolved, the
    // action ran, and this early return refused before `invoke` was ever reached, so no IPC, no write
    // and no editor refresh ever happened.
    //
    // Everything downstream is unchanged and can still refuse: main re-reads the file, checks the
    // target range against `expectedOriginal`, validates the range bounds, and applies the path guard
    // and secrets denylist. A forced write is an override of verification, never of file safety.
    if (!gate.enabled && !forced) {
      const blocked: ApplyAttempt = { ...attempt, durationMs: 0 };
      set({ lastApplyAttempt: blocked });
      console.error('[apply] blocked', { gate, rootCause: rootCauseOf(blocked) });
      return false;
    }
    if (!gate.enabled) {
      // Audit the override at the point it takes effect, with the verdict it overrode.
      console.error('[apply] FORCED past a failed gate', { reason: gate.reason, explanation: gate.explanation });
    }

    // Same reason as `run()`: `invoke` rejects on a missing/throwing main handler, and this one is
    // awaited behind a click (`void applyRepair()`). An escape here would be an uncaught rejection
    // AND a silent no-op on the button that writes to the user's file — the worst place for one.
    let result: Awaited<ReturnType<typeof invoke<'ai:applyRepair'>>>;
    try {
      result = await invoke('ai:applyRepair', request);
    } catch (error) {
      const message =
        error instanceof Error && error.message !== ''
          ? error.message
          : 'Fixora could not reach its own background process to apply this repair.';
      set({
        lastApplyAttempt: { ...attempt, durationMs: Date.now() - startedAt, transportError: message },
        errorMessage: message,
      });
      return false;
    }
    const settled: ApplyAttempt = {
      ...attempt,
      durationMs: Date.now() - startedAt,
      response: result.ok ? result.value : null,
      transportError: result.ok ? null : result.error.message,
    };
    set({ lastApplyAttempt: settled });

    const fileName = basename(proposal.target.file);
    if (!result.ok) {
      // The preview is NOT torn down on failure. Setting status to 'error' unmounted the whole
      // repair result, so the user lost the proposal they were about to apply — the failure and the
      // thing that failed both disappeared, which is why this read as "Apply does nothing".
      set({ errorMessage: result.error.message });
      notify('error', 'Repair Failed ❌', `${fileName} — ${result.error.message}`);
      return false;
    }
    if (!result.value.applied) {
      set({ errorMessage: result.value.message });
      notify('error', 'Repair Failed ❌', `${fileName} — ${result.value.message}`);
      return false;
    }
    notify('success', 'Fix Applied ✅', fileName);
    // Counted only for repairs that actually landed on disk — the feedback prompt is meant to
    // follow the product working, not the button being pressed.
    useFeedbackStore.getState().recordRepair();
    // Reflect the applied repair everywhere the user can see it: the open buffer (so the editor shows
    // the new code, undo intact) and the history list.
    const reread = await invoke('fs:readFile', { relPath: proposal.target.file });
    if (reread.ok) refreshModelText(proposal.target.file, reread.value.file.content);
    void useHistoryStore.getState().refresh();
    get().dismiss();
    return true;
  },

  dismiss: () => {
    // Supersede any run still in flight, so its late result cannot reopen what this closes.
    runToken += 1;
    set({
      status: 'idle',
      stage: null,
      activeFindingId: null,
      activeProfile: null,
      streamText: '',
      // A new run (or a dismissal) ends the previous explanation thread — follow-ups about an
      // explanation that is no longer on screen would answer questions the user cannot see.
      followUps: [],
      followUpPending: false,
      proposal: null,
      blocked: null,
      errorMessage: null,
      retryable: false,
      failure: null,
    });
  },

  listen: () => {
    // Streamed prose (explain) arrives token by token; the terminal state comes from run()'s result.
    const offDelta = subscribe('ai:delta', ({ text }) => {
      if (get().status === 'running') set((s) => ({ streamText: s.streamText + text }));
    });
    // Progress. Only the `stage` of a still-running run is taken from here: the TERMINAL state is
    // owned by `run()`'s awaited result, and letting an event set it too would be two sources of
    // truth for the same fact. Guarded on `status === 'running'` so a late event from an
    // already-finished run cannot resurrect the spinner.
    const offState = subscribe('ai:runState', (state) => {
      if (state.status !== 'running' || state.stage === undefined) return;
      if (get().status === 'running') set({ stage: state.stage });
    });
    return () => {
      offDelta();
      offState();
    };
  },
}));


