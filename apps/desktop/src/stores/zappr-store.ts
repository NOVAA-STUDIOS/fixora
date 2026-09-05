import type { ZapprStep } from '@fixora/shared-types';
import { create } from 'zustand';

import { useWorkspaceStore } from '../features/workspace/workspace-store.js';
import { invoke, subscribe } from '../lib/bridge.js';

type StepState = {
  step: ZapprStep;
  status: 'pending' | 'running' | 'done' | 'error';
};

type ZapprState = {
  isOpen: boolean;
  isRunning: boolean;
  prompt: string;
  plan: ZapprStep[] | null;
  currentStep: number;
  steps: StepState[];
  summary: string | null;
  error: string | null;

  open: () => void;
  close: () => void;
  setPrompt: (prompt: string) => void;
  run: () => Promise<void>;
  cancel: () => Promise<void>;
  listen: () => () => void;
};

export const useZapprStore = create<ZapprState>((set, get) => ({
  isOpen: false,
  isRunning: false,
  prompt: '',
  plan: null,
  currentStep: -1,
  steps: [],
  summary: null,
  error: null,

  open: () => {
    set({
      isOpen: true,
      isRunning: false,
      prompt: '',
      plan: null,
      currentStep: -1,
      steps: [],
      summary: null,
      error: null,
    });
  },

  close: () => {
    set({ isOpen: false });
  },

  setPrompt: (prompt) => {
    set({ prompt });
  },

  run: async () => {
    const prompt = get().prompt.trim();
    if (prompt === '') return;
    const workspaceRoot = useWorkspaceStore.getState().workspace?.rootPath ?? '';
    set({ isRunning: true, error: null });
    const result = await invoke('zappr:run', { prompt, workspaceRoot });
    if (!result.ok || !result.value.ok) {
      set({
        isRunning: false,
        error: result.ok ? (result.value.error ?? 'Zappr failed.') : result.error.message,
      });
    }
  },

  cancel: async () => {
    await invoke('zappr:cancel', {});
    set({ isRunning: false });
  },

  listen: () => {
    const offPlan = subscribe('zappr:plan', ({ steps, summary }) => {
      set({ plan: steps, summary, steps: steps.map((step) => ({ step, status: 'pending' })) });
    });
    const offStepStart = subscribe('zappr:stepStart', ({ index }) => {
      set((state) => ({
        currentStep: index,
        steps: state.steps.map((s, i) => (i === index ? { ...s, status: 'running' } : s)),
      }));
    });
    const offStepDone = subscribe('zappr:stepDone', ({ index, success }) => {
      set((state) => ({
        steps: state.steps.map((s, i) => (i === index ? { ...s, status: success ? 'done' : 'error' } : s)),
      }));
    });
    const offDone = subscribe('zappr:done', () => {
      set({ isRunning: false });
    });
    return () => {
      offPlan();
      offStepStart();
      offStepDone();
      offDone();
    };
  },
}));
