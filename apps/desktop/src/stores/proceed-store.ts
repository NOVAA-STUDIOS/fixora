import type { GateMatchInfo, ProceedProposal } from '@fixora/shared-types';
import { create } from 'zustand';

import { activeCursorLine, activeSelectionRange } from '../features/editor/active-editor.js';
import { useEditorStore } from '../features/editor/editor-store.js';
import { refreshModelText } from '../features/editor/models.js';
import { useFindingsStore } from '../features/findings/findings-store.js';
import { invoke } from '../lib/bridge.js';

/**
 * Proceed Mode state (P2.2R).
 *
 * Deliberately thin: it sends the instruction + caret to `proceed:run`, holds the returned VERIFIED
 * proposal for preview, and — on Accept — applies it through `ai:applyRepair`, the same guarded write
 * path Repair uses. Nothing here re-implements verification or apply; a proposal only ever reaches
 * this store after main has already verified it, and Cancel simply discards it without writing.
 */

export type ProceedStatus = 'idle' | 'running' | 'preview' | 'error';

/**
 * The exact `proceed:run` request payload, captured at the moment it is sent. Retry replays THIS —
 * never the user's current editor state — so a failed request retried after the user moved the
 * cursor, changed the selection, or switched tabs still targets exactly what failed (Q3 Defect #3).
 * This mirrors Repair's own retry semantics, which is pinned to a stable `findingId` rather than
 * anything read live off the editor at retry-time.
 */
type ProceedRequestContext = {
  readonly instruction: string;
  readonly file: string;
  readonly selectionStartLine: number;
  readonly selectionEndLine?: number;
};

type ProceedState = {
  status: ProceedStatus;
  /** The verified proposal awaiting the user's Accept/Cancel. */
  proposal: ProceedProposal | null;
  /** A refusal the user can act on: unknown intent, a regression, a provider error. */
  message: string | null;
  /** Secret-gate matches, when the request was blocked before sending. */
  blocked: GateMatchInfo[] | null;
  applying: boolean;
  /** True when the failure could plausibly succeed on a retry (quota reset, provider blip). */
  retryable: boolean;
  /** The exact request that failed, so Retry reproduces it rather than reconstructing a new one. */
  lastRequest: ProceedRequestContext | null;

  run: (instruction: string) => Promise<void>;
  retry: () => Promise<void>;
  accept: () => Promise<boolean>;
  cancel: () => Promise<void>;
};

export const useProceedStore = create<ProceedState>((set, get) => {
  // A monotonic counter identifying "the current request", private to this store instance — never
  // exposed as reactive state, because nothing should re-render off it. `cancel()` and every new
  // `sendRequest()` call bump it; a `sendRequest()` in flight captures its OWN value and checks it
  // again after the await, so a result that arrives after being superseded (by Cancel, or by a newer
  // request) is silently dropped instead of overwriting whatever state is current by then (Q3 Defect
  // #4: cancel before/during streaming, a near-simultaneous provider completion, and a fresh request
  // started right after cancelling must never let a late result win).
  let requestToken = 0;

  /** The single path to `proceed:run` — `run()` builds `request` from live editor state; `retry()`
   *  replays a previously captured one untouched. Both funnel through here so the outcome handling
   *  (including the Defect #2 file-scoping guard) can never drift between the two callers. */
  const sendRequest = async (request: ProceedRequestContext): Promise<void> => {
    const token = ++requestToken;
    set({
      status: 'running',
      proposal: null,
      message: null,
      blocked: null,
      retryable: false,
      lastRequest: request,
    });
    const result = await invoke('proceed:run', request);
    // Superseded while this was in flight — by Cancel, or by a newer run()/retry() — so whatever this
    // resolved with (a real proposal, a cancellation echo, anything) is stale. Say nothing further.
    if (token !== requestToken) return;

    if (!result.ok) {
      // Transport failure between renderer and main — a UI-layer failure, retryable by nature.
      set({ status: 'error', message: result.error.message, retryable: true });
      return;
    }
    const outcome = result.value;
    switch (outcome.status) {
      case 'ok':
        // The user may have switched tabs while this request was in flight. A proposal is only ever
        // valid for the file it was generated against — showing it for whatever tab now happens to be
        // active would make Accept silently write to a file the user is no longer looking at.
        if (useEditorStore.getState().activeTab !== request.file) {
          set({
            status: 'error',
            message: 'You switched files while this was generating, so the proposal was discarded.',
          });
          return;
        }
        set({ status: 'preview', proposal: outcome.proposal, message: null });
        return;
      case 'unknown-intent':
        set({ status: 'error', message: outcome.message });
        return;
      case 'blocked':
        set({
          status: 'error',
          blocked: outcome.matches,
          message: 'That request was blocked because the code in scope contains a secret.',
        });
        return;
      case 'rejected':
        // Verification refused it. Say so plainly — this is the safety net working, not a crash.
        set({ status: 'error', message: `Edit rejected by verification: ${outcome.reason}` });
        return;
      default:
        set({
          status: 'error',
          message: outcome.message,
          retryable: outcome.retryable === true,
        });
    }
  };

  return {
    status: 'idle',
    proposal: null,
    message: null,
    blocked: null,
    applying: false,
    retryable: false,
    lastRequest: null,

    retry: async () => {
      // Replays the captured request verbatim — never re-reads the active tab, cursor, or selection.
      const request = get().lastRequest;
      if (request === null) return;
      await sendRequest(request);
    },

    run: async (instruction) => {
      const file = useEditorStore.getState().activeTab;
      if (file === null) {
        set({
          status: 'error',
          message: 'Open a file first, then describe the change.',
          proposal: null,
        });
        return;
      }
      // The caret decides the scope. A real selection wins over a bare cursor.
      const selection = activeSelectionRange();
      const caret = activeCursorLine();
      if (selection === null && caret === null) {
        set({ status: 'error', message: 'Place the cursor in the code you want to change.' });
        return;
      }

      await sendRequest({
        instruction,
        file,
        selectionStartLine: selection?.startLine ?? caret ?? 1,
        ...(selection !== null ? { selectionEndLine: selection.endLine } : {}),
      });
    },

    accept: async () => {
      const { proposal } = get();
      if (proposal === null) return false;
      set({ applying: true });
      // The SAME verified write path Repair uses — range + expectedOriginal, so a file that changed
      // underneath is refused rather than clobbered.
      const result = await invoke('ai:applyRepair', {
        file: proposal.target.file,
        startLine: proposal.target.startLine,
        endLine: proposal.target.endLine,
        code: proposal.editedCode,
        expectedOriginal: proposal.originalCode,
      });
      set({ applying: false });

      if (!result.ok) {
        set({ status: 'error', message: result.error.message });
        return false;
      }
      if (!result.value.applied) {
        set({ status: 'error', message: result.value.message });
        return false;
      }

      // Reflect the applied edit everywhere the user can see it: the open buffer (undo intact), then
      // re-analysis so findings, diagnostics and decorations all follow from one refresh.
      const reread = await invoke('fs:readFile', { relPath: proposal.target.file });
      if (reread.ok) refreshModelText(proposal.target.file, reread.value.file.content);
      void useFindingsStore.getState().refresh();
      set({ status: 'idle', proposal: null, message: null, blocked: null });
      return true;
    },

    cancel: async () => {
      // Invalidate any in-flight sendRequest() BEFORE the IPC round trip, so nothing it later
      // resolves with can land after this point, however the timing falls out.
      requestToken++;
      // A real abort, not just hiding the panel: reaches the SAME AbortController `proceed:run` is
      // using in main (mirrors `ai:cancel` exactly — see proceed.handlers.ts). While in `preview`
      // nothing is running — main's `active` is already null by then — so this is a harmless no-op
      // that still discards the proposal below; nothing was written, so there is nothing to undo.
      await invoke('proceed:cancel', {});
      set({ status: 'idle', proposal: null, message: null, blocked: null, retryable: false });
    },
  };
});

// A preview proposal is scoped to the file it was generated for. If the user switches the active
// editor tab away from that file, the proposal must stop being reachable from Accept — otherwise
// Accept would silently write to a file the user is no longer looking at (Q3 Defect #2). This does
// not touch the `ai:applyRepair` staleness guard (expectedOriginal) at all; it is a separate, earlier
// line of defence that prevents the stale-but-still-valid-looking proposal from being offered.
useEditorStore.subscribe((state, prevState) => {
  if (state.activeTab === prevState.activeTab) return;
  const { status, proposal } = useProceedStore.getState();
  if (status !== 'preview' || proposal === null) return;
  if (state.activeTab === proposal.target.file) return;
  useProceedStore.setState({ status: 'idle', proposal: null, message: null, blocked: null });
});
