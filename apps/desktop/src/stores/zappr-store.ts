import type { ZapprAction, ZapprStep } from '@fixora/shared-types';
import { create } from 'zustand';

import { useFindingsStore } from '../features/findings/findings-store.js';
import { useWorkspaceStore } from '../features/workspace/workspace-store.js';
import { invoke, subscribe } from '../lib/bridge.js';

import { useUiStore } from './ui-store.js';

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
  mode: 'chat' | 'file' | 'math' | 'repair' | null;
  chatResponse: string | null;
  streamingText: string;
  pendingAction: ZapprAction | null;
  currentFilePath: string | null;
  currentFileContent: string | null;

  open: () => void;
  close: () => void;
  setPrompt: (prompt: string) => void;
  clearError: () => void;
  setMode: (mode: 'chat' | 'file' | 'math' | 'repair' | null) => void;
  appendDelta: (text: string) => void;
  setChatResponse: (text: string | null) => void;
  executeAction: (action: ZapprAction) => Promise<string | null>;
  run: () => Promise<void>;
  cancel: () => Promise<void>;
  listen: () => () => void;
};

let deltaBuffer = '';
let flushTimer: ReturnType<typeof setTimeout> | null = null;

export const useZapprStore = create<ZapprState>((set, get) => ({
  isOpen: false,
  isRunning: false,
  prompt: '',
  plan: null,
  currentStep: -1,
  steps: [],
  summary: null,
  error: null,
  mode: null,
  chatResponse: null,
  streamingText: '',
  pendingAction: null,
  currentFilePath: null,
  currentFileContent: null,

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
      mode: null,
      chatResponse: null,
      streamingText: '',
      pendingAction: null,
      currentFilePath: null,
      currentFileContent: null,
    });
  },

  close: () => {
    set({ isOpen: false });
  },

  setPrompt: (prompt) => {
    set({ prompt });
  },

  clearError: () => {
    set({ error: null });
  },

  setMode: (mode) => {
    set({ mode });
  },

  appendDelta: (text) => {
    deltaBuffer += text;
    if (flushTimer) return;
    flushTimer = setTimeout(() => {
      const buffered = deltaBuffer;
      deltaBuffer = '';
      flushTimer = null;
      set((state) => ({ streamingText: state.streamingText + buffered }));
    }, 30);
  },

  setChatResponse: (text) => {
    set({ chatResponse: text, streamingText: '' });
  },

  executeAction: async (action) => {
    switch (action.type) {
      case 'open_settings':
        useUiStore.getState().setActiveView('settings');
        return 'Opening settings...';

      case 'set_theme':
        useUiStore.getState().setTheme(action.theme);
        return `Switched to ${action.theme} mode ✓`;

      case 'set_provider':
        useUiStore.getState().setActiveView('settings');
        return `Opening AI settings for ${action.providerId}...`;

      case 'run_analysis':
        await useFindingsStore.getState().run();
        return 'Running analysis... ✓';

      case 'create_file':
        return `Creating ${action.path}...`;

      default:
        return null;
    }
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
    const offMode = subscribe('zappr:mode', ({ mode }) => {
      set({ mode });
    });
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
    const offDelta = subscribe('zappr:delta', ({ text }) => {
      get().appendDelta(text);
    });
    const offFileProgress = subscribe('zappr:fileProgress', ({ filePath, content }) => {
      set({ currentFilePath: filePath, currentFileContent: content });
    });
    const offDone = subscribe('zappr:done', ({ chatResponse }) => {
      set({
        isRunning: false,
        currentFilePath: null,
        currentFileContent: null,
        ...(chatResponse !== undefined ? { chatResponse, streamingText: '' } : {}),
      });
    });
    const offActionResult = subscribe('zappr:actionResult', ({ message, action }) => {
      set({ chatResponse: message, isRunning: false, pendingAction: action });
      void get().executeAction(action);
    });
    return () => {
      offMode();
      offPlan();
      offStepStart();
      offStepDone();
      offDelta();
      offFileProgress();
      offDone();
      offActionResult();
    };
  },
}));
