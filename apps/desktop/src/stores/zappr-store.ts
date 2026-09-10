import type { ZapprAction, ZapprStep } from '@fixora/shared-types';
import { create } from 'zustand';

import { toInternalBinding, useUserKeybindingsStore } from '../features/commands/user-keybindings-store.js';
import { useEditorStore } from '../features/editor/editor-store.js';
import { useFindingsStore } from '../features/findings/findings-store.js';
import { useTerminalStore } from '../features/terminal/terminal-store.js';
import { useWorkspaceStore } from '../features/workspace/workspace-store.js';
import { invoke, subscribe } from '../lib/bridge.js';

import { useUiStore } from './ui-store.js';

export type ZapprMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  type: 'chat' | 'file' | 'repair' | 'terminal' | 'error';
  steps?: {
    filePath: string;
    type: string;
    description: string;
    status: 'pending' | 'running' | 'done' | 'error';
  }[];
  terminalCommand?: string;
  timestamp: number;
};

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
  lastTerminalCommand: string | null;
  lastKeyUpdateProvider: string | null;
  lastShortcutCreated: { keys: string; description: string; unresolved: boolean } | null;
  selectedCode: string | null;
  selectedCodeFile: string | null;
  messages: ZapprMessage[];

  open: () => void;
  close: () => void;
  setPrompt: (prompt: string) => void;
  clearError: () => void;
  setMode: (mode: 'chat' | 'file' | 'math' | 'repair' | null) => void;
  appendDelta: (text: string) => void;
  setChatResponse: (text: string | null) => void;
  setLastTerminalCommand: (cmd: string | null) => void;
  setLastKeyUpdateProvider: (provider: string | null) => void;
  setLastShortcutCreated: (v: { keys: string; description: string; unresolved: boolean } | null) => void;
  setSelectedCode: (code: string | null, file: string | null) => void;
  addMessage: (msg: ZapprMessage) => void;
  clearMessages: () => void;
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
  lastTerminalCommand: null,
  lastKeyUpdateProvider: null,
  lastShortcutCreated: null,
  selectedCode: null,
  selectedCodeFile: null,
  messages: [],

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
      lastTerminalCommand: null,
      lastKeyUpdateProvider: null,
      lastShortcutCreated: null,
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

  setLastTerminalCommand: (cmd) => {
    set({ lastTerminalCommand: cmd });
  },

  setLastKeyUpdateProvider: (provider) => {
    set({ lastKeyUpdateProvider: provider });
  },

  setLastShortcutCreated: (v) => {
    set({ lastShortcutCreated: v });
  },

  setSelectedCode: (code, file) => {
    set({ selectedCode: code, selectedCodeFile: file });
  },

  addMessage: (msg) => {
    set((state) => ({ messages: [...state.messages, msg] }));
  },

  clearMessages: () => {
    set({ messages: [] });
  },

  executeAction: async (action) => {
    console.warn('[Zappr:UI] Executing action', { type: action.type });
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

      case 'run_terminal_command': {
        console.warn('[Zappr:UI] Terminal exec', { command: action.command });
        const activeId = useTerminalStore.getState().activeId;
        if (activeId === null) {
          get().setLastTerminalCommand(null);
          return 'Terminal not open. Open the terminal panel first.';
        }
        await invoke('terminal:write', { id: activeId, data: `${action.command}\n` });
        get().setLastTerminalCommand(action.command);
        return `Command sent to terminal: ${action.command}`;
      }

      case 'update_api_key': {
        const KNOWN_PROVIDERS = ['openrouter', 'gemini', 'openai', 'anthropic', 'groq', 'azure', 'ollama'];
        if (action.provider === '') {
          return `Which provider is this key for? Supported: ${KNOWN_PROVIDERS.join(', ')}.`;
        }
        if (!KNOWN_PROVIDERS.includes(action.provider)) {
          return `Unknown provider: ${action.provider}. Supported: ${KNOWN_PROVIDERS.join(', ')}.`;
        }
        const result = await invoke('providers:setKey', { id: action.provider, key: action.apiKey });
        if (!result.ok) return `Could not save the API key for ${action.provider}.`;
        get().setLastKeyUpdateProvider(action.provider);
        return `API key updated for ${action.provider}. Restart may be required for changes to take effect.`;
      }

      case 'create_shortcut': {
        if (!/^(Ctrl|Alt|Shift|Meta)(\+(Ctrl|Alt|Shift|Meta))*\+[A-Za-z0-9]$/i.test(action.keys)) {
          return 'Invalid shortcut format. Example: Ctrl+Shift+B';
        }
        useUserKeybindingsStore.getState().setBinding({
          commandId: action.commandId,
          keys: toInternalBinding(action.keys),
          displayKeys: action.keys,
          description: action.description,
        });
        get().setLastShortcutCreated({
          keys: action.keys,
          description: action.description,
          unresolved: action.unresolved,
        });
        return action.unresolved
          ? `Shortcut ${action.keys} saved, but I couldn't map '${action.commandId}' to a known Fixora command. You can assign it manually in Settings → Keybindings.`
          : `Shortcut ${action.keys} → ${action.description} saved successfully.`;
      }

      default:
        return null;
    }
  },

  run: async () => {
    const prompt = get().prompt.trim();
    if (prompt === '') return;
    const workspaceRoot = useWorkspaceStore.getState().workspace?.rootPath ?? '';
    const { activeTab, tabs } = useEditorStore.getState();
    const { selectedCode, selectedCodeFile } = get();
    set({ isRunning: true, error: null });
    get().addMessage({
      id: crypto.randomUUID(),
      role: 'user',
      content: prompt,
      type: 'chat',
      timestamp: Date.now(),
    });
    const result = await invoke('zappr:run', {
      prompt,
      workspaceRoot,
      activeFile: activeTab,
      openTabs: tabs.map((t) => t.relPath),
      selectedCode,
      selectedCodeFile,
    });
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
    const offMode = subscribe('zappr:mode', (payload) => {
      console.warn('[Zappr:UI]', 'zappr:mode', payload);
      set({ mode: payload.mode });
    });
    const offPlan = subscribe('zappr:plan', (payload) => {
      console.warn('[Zappr:UI]', 'zappr:plan', payload);
      const { steps, summary } = payload;
      set({ plan: steps, summary, steps: steps.map((step) => ({ step, status: 'pending' })) });
    });
    const offStepStart = subscribe('zappr:stepStart', (payload) => {
      console.warn('[Zappr:UI]', 'zappr:stepStart', payload);
      const { index } = payload;
      set((state) => ({
        currentStep: index,
        steps: state.steps.map((s, i) => (i === index ? { ...s, status: 'running' } : s)),
      }));
    });
    const offStepDone = subscribe('zappr:stepDone', (payload) => {
      console.warn('[Zappr:UI]', 'zappr:stepDone', payload);
      const { index, success } = payload;
      set((state) => ({
        steps: state.steps.map((s, i) => (i === index ? { ...s, status: success ? 'done' : 'error' } : s)),
      }));
    });
    const offDelta = subscribe('zappr:delta', ({ text }) => {
      get().appendDelta(text);
    });
    const offFileProgress = subscribe('zappr:fileProgress', (payload) => {
      console.warn('[Zappr:UI]', 'zappr:fileProgress', payload);
      set({ currentFilePath: payload.filePath, currentFileContent: payload.content });
    });
    const offDone = subscribe('zappr:done', (payload) => {
      console.warn('[Zappr:UI]', 'zappr:done', payload);
      const { chatResponse } = payload;
      const prevStreaming = get().streamingText;
      const prevMode = get().mode;
      set({
        isRunning: false,
        currentFilePath: null,
        currentFileContent: null,
        ...(chatResponse !== undefined ? { chatResponse, streamingText: '' } : {}),
      });
      get().addMessage({
        id: crypto.randomUUID(),
        role: 'assistant',
        content: chatResponse ?? prevStreaming,
        type: prevMode === null || prevMode === 'math' ? 'chat' : prevMode,
        timestamp: Date.now(),
      });
    });
    const offActionResult = subscribe('zappr:actionResult', (payload) => {
      console.warn('[Zappr:UI]', 'zappr:actionResult', payload);
      const { message, action } = payload;
      set({ chatResponse: message, isRunning: false, pendingAction: action });
      void get()
        .executeAction(action)
        .then((result) => {
          console.warn('[Zappr:UI] Action result', result);
          if (result !== null) set({ chatResponse: result });
        });
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
