import type { AiConfig, AiProposal, GateMatchInfo, TaskProfile } from '@fixora/shared-types';
import { create } from 'zustand';

import { refreshModelText } from '../features/editor/models.js';
import { useHistoryStore } from '../features/history/history-store.js';
import { invoke, subscribe } from '../lib/bridge.js';

/**
 * The renderer's AI state (M5, BYOK). It holds the *config the renderer is allowed to know* (configured,
 * model, a key hint — never the key) and the state of the one active run: streamed prose, the resulting
 * proposal, or a typed failure. The key itself is write-only from here: `setKey` sends it to main, and
 * nothing ever reads it back.
 */

export type AiRunStatus = 'idle' | 'running' | 'blocked' | 'error' | 'done';

type AiState = {
  config: AiConfig | null;

  loadConfig: () => Promise<void>;
  setKey: (key: string, model?: string) => Promise<string | null>;
  clearKey: () => Promise<void>;
  setModel: (model: string) => Promise<void>;

  status: AiRunStatus;
  activeFindingId: string | null;
  activeProfile: TaskProfile | null;
  streamText: string;
  proposal: AiProposal | null;
  blocked: readonly GateMatchInfo[] | null;
  errorMessage: string | null;

  run: (profile: TaskProfile, findingId: string) => Promise<void>;
  cancel: () => Promise<void>;
  /** Apply the current repair proposal to the file on disk. Returns true on success. */
  applyRepair: () => Promise<boolean>;
  dismiss: () => void;
  listen: () => () => void;
};

export const useAiStore = create<AiState>((set, get) => ({
  config: null,

  loadConfig: async () => {
    const result = await invoke('ai:getConfig', {});
    if (result.ok) set({ config: result.value });
  },

  setKey: async (key, model) => {
    const result = await invoke('ai:setKey', model === undefined ? { key } : { key, model });
    if (result.ok) {
      set({ config: result.value });
      return null;
    }
    return result.error.message;
  },

  clearKey: async () => {
    const result = await invoke('ai:clearKey', {});
    if (result.ok) set({ config: result.value });
  },

  setModel: async (model) => {
    const result = await invoke('ai:setModel', { model });
    if (result.ok) set({ config: result.value });
  },

  status: 'idle',
  activeFindingId: null,
  activeProfile: null,
  streamText: '',
  proposal: null,
  blocked: null,
  errorMessage: null,

  run: async (profile, findingId) => {
    set({
      status: 'running',
      activeFindingId: findingId,
      activeProfile: profile,
      streamText: '',
      proposal: null,
      blocked: null,
      errorMessage: null,
    });

    const result = await invoke('ai:run', { profile, findingId });
    if (!result.ok) {
      set({ status: 'error', errorMessage: result.error.message });
      return;
    }
    const response = result.value;
    if (response.status === 'ok') {
      set({ status: 'done', proposal: response.proposal });
    } else if (response.status === 'blocked') {
      set({ status: 'blocked', blocked: response.matches });
    } else {
      set({ status: 'error', errorMessage: response.message });
    }
  },

  cancel: async () => {
    await invoke('ai:cancel', {});
    set({ status: 'idle' });
  },

  applyRepair: async () => {
    const { proposal } = get();
    if (proposal?.profile !== 'repair') return false;
    const result = await invoke('ai:applyRepair', {
      file: proposal.target.file,
      startLine: proposal.target.startLine,
      endLine: proposal.target.endLine,
      code: proposal.repairedCode,
      expectedOriginal: proposal.originalCode,
      historyId: proposal.historyId,
    });
    if (!result.ok) {
      set({ status: 'error', errorMessage: result.error.message });
      return false;
    }
    // Reflect the applied repair everywhere the user can see it: the open buffer (so the editor shows
    // the new code, undo intact) and the history list.
    const reread = await invoke('fs:readFile', { relPath: proposal.target.file });
    if (reread.ok) refreshModelText(proposal.target.file, reread.value.file.content);
    void useHistoryStore.getState().refresh();
    get().dismiss();
    return true;
  },

  dismiss: () => {
    set({
      status: 'idle',
      activeFindingId: null,
      activeProfile: null,
      streamText: '',
      proposal: null,
      blocked: null,
      errorMessage: null,
    });
  },

  listen: () => {
    // Streamed prose (explain) arrives token by token; the terminal state comes from run()'s result.
    const offDelta = subscribe('ai:delta', ({ text }) => {
      if (get().status === 'running') set((s) => ({ streamText: s.streamText + text }));
    });
    return () => {
      offDelta();
    };
  },
}));
