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

type ProceedState = {
  status: ProceedStatus;
  /** The verified proposal awaiting the user's Accept/Cancel. */
  proposal: ProceedProposal | null;
  /** A refusal the user can act on: unknown intent, a regression, a provider error. */
  message: string | null;
  /** Secret-gate matches, when the request was blocked before sending. */
  blocked: GateMatchInfo[] | null;
  applying: boolean;

  run: (instruction: string) => Promise<void>;
  accept: () => Promise<boolean>;
  cancel: () => void;
};

export const useProceedStore = create<ProceedState>((set, get) => ({
  status: 'idle',
  proposal: null,
  message: null,
  blocked: null,
  applying: false,

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

    set({ status: 'running', proposal: null, message: null, blocked: null });
    const result = await invoke('proceed:run', {
      instruction,
      file,
      selectionStartLine: selection?.startLine ?? caret ?? 1,
      ...(selection !== null ? { selectionEndLine: selection.endLine } : {}),
    });

    if (!result.ok) {
      set({ status: 'error', message: result.error.message });
      return;
    }
    const outcome = result.value;
    switch (outcome.status) {
      case 'ok':
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
        set({ status: 'error', message: outcome.message });
    }
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

  cancel: () => {
    // Discard the proposal. Nothing was written, so there is nothing to undo.
    set({ status: 'idle', proposal: null, message: null, blocked: null });
  },
}));
