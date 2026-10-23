import type { ZapprAction, ZapprStep } from '@fixora/shared-types';
import { create } from 'zustand';

import { toInternalBinding, useUserKeybindingsStore } from '../features/commands/user-keybindings-store.js';
// editor-store.ts dynamically imports this module too (auto-fix-on-save); the cycle never
// actually resolves at runtime since that side only imports lazily, inside an async function.
// eslint-disable-next-line import-x/no-cycle
import { useEditorStore } from '../features/editor/editor-store.js';
import { useFindingsStore } from '../features/findings/findings-store.js';
import { useTerminalStore } from '../features/terminal/terminal-store.js';
import { useWorkspaceStore } from '../features/workspace/workspace-store.js';
import { normalizeMentionPath, parseMentionPaths } from '../features/zappr/mention-context.js';
import { invoke, subscribe } from '../lib/bridge.js';

import { useUiStore } from './ui-store.js';

export type ZapprMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  type: 'chat' | 'file' | 'repair' | 'review' | 'terminal' | 'error';
  steps?: {
    filePath: string;
    type: string;
    description: string;
    status: 'pending' | 'running' | 'done' | 'error';
  }[];
  terminalCommand?: string;
  terminalOutput?: string;
  timestamp: number;
};

type StepState = {
  step: ZapprStep;
  status: 'pending' | 'running' | 'done' | 'error';
};

export type ZapprOutcome = {
  kind: 'success' | 'rejected' | 'cancelled' | 'reverted' | 'rollback-incomplete' | 'error';
  message: string;
};

export type ZapprRunContext = {
  activeFile: string | null;
  openTabs: string[];
  selectedCode: string | null;
  selectedCodeFile: string | null;
  atMentions: string[];
  smartContextFiles?: string[];
};

export type ZapprCommandRunRequest = { id: string; prompt: string; workspaceRoot: string | null };

type ZapprState = {
  isOpen: boolean;
  isRunning: boolean;
  isCancelling: boolean;
  prompt: string;
  plan: ZapprStep[] | null;
  currentStep: number;
  steps: StepState[];
  summary: string | null;
  error: string | null;
  mode: 'chat' | 'file' | 'math' | 'repair' | 'review' | null;
  chatResponse: string | null;
  streamingText: string;
  pendingAction: ZapprAction | null;
  pendingApprovalId: string | null;
  isApproving: boolean;
  currentFilePath: string | null;
  currentFileContent: string | null;
  lastTerminalCommand: string | null;
  lastKeyUpdateProvider: string | null;
  lastShortcutCreated: { keys: string; description: string; unresolved: boolean } | null;
  selectedCode: string | null;
  selectedCodeFile: string | null;
  selectedCodeStartLine: number | null;
  selectedCodeEndLine: number | null;
  selectedCodeLanguage: string | null;
  selectedCodeWorkspaceRoot: string | null;
  mentionFiles: string[];
  messages: ZapprMessage[];
  activeRunId: string | null;
  lastTerminalOutput: string | null;
  outcome: ZapprOutcome | null;
  commandRunRequest: ZapprCommandRunRequest | null;

  open: () => void;
  close: () => void;
  setPrompt: (prompt: string) => void;
  clearError: () => void;
  setMode: (mode: 'chat' | 'file' | 'math' | 'repair' | 'review' | null) => void;
  appendDelta: (text: string) => void;
  setChatResponse: (text: string | null) => void;
  setLastTerminalCommand: (cmd: string | null) => void;
  setLastKeyUpdateProvider: (provider: string | null) => void;
  setLastShortcutCreated: (v: { keys: string; description: string; unresolved: boolean } | null) => void;
  setLastTerminalOutput: (output: string | null) => void;
  setSelectedCode: (code: string | null, file: string | null) => void;
  captureSelection: (context: { code: string; file: string; startLine?: number; endLine?: number; language?: string | null; workspaceRoot?: string | null }) => void;
  clearSelectedCode: () => void;
  addMessage: (msg: ZapprMessage) => void;
  clearMessages: () => void;
  executeAction: (action: ZapprAction) => Promise<string | null>;
  setMentionFiles: (files: string[]) => void;
  removeMentionFile: (file: string) => void;
  clearMentionFiles: () => void;
  requestCommandRun: (prompt: string) => void;
  consumeCommandRunRequest: (id: string) => void;
  run: (context?: ZapprRunContext) => Promise<void>;
  approvePendingPlan: () => Promise<void>;
  rejectPendingPlan: () => Promise<void>;
  cancel: () => Promise<void>;
  listen: () => () => void;
};

let deltaBuffer = '';
let flushTimer: ReturnType<typeof setTimeout> | null = null;

let terminalCaptureActive = false;
let capturedOutput = '';
let captureTimer: ReturnType<typeof setTimeout> | null = null;

export const useZapprStore = create<ZapprState>((set, get) => ({
  isOpen: false,
  isRunning: false,
  isCancelling: false,
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
  pendingApprovalId: null,
  isApproving: false,
  currentFilePath: null,
  currentFileContent: null,
  lastTerminalCommand: null,
  lastKeyUpdateProvider: null,
  lastShortcutCreated: null,
  selectedCode: null,
  selectedCodeFile: null,
  selectedCodeStartLine: null,
  selectedCodeEndLine: null,
  selectedCodeLanguage: null,
  selectedCodeWorkspaceRoot: null,
  mentionFiles: [],
  messages: [],
  activeRunId: null,
  lastTerminalOutput: null,
  outcome: null,
  commandRunRequest: null,

  open: () => {
    set({
      isOpen: true,
      isRunning: false,
      isCancelling: false,
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
      pendingApprovalId: null,
      isApproving: false,
      currentFilePath: null,
      currentFileContent: null,
      lastTerminalCommand: null,
      lastKeyUpdateProvider: null,
      lastShortcutCreated: null,
      activeRunId: null,
      outcome: null,
      commandRunRequest: null,
    });
  },

  close: () => {
    set({ isOpen: false });
  },

  setPrompt: (prompt) => {
    set({ prompt, mentionFiles: parseMentionPaths(prompt) });
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

  setLastTerminalOutput: (output) => {
    set({ lastTerminalOutput: output });
  },

  setSelectedCode: (code, file) => {
    set({ selectedCode: code, selectedCodeFile: file, selectedCodeStartLine: null, selectedCodeEndLine: null, selectedCodeLanguage: null, selectedCodeWorkspaceRoot: useWorkspaceStore.getState().workspace?.rootPath ?? null });
  },

  captureSelection: ({ code, file, startLine, endLine, language, workspaceRoot }) => {
    set({
      selectedCode: code,
      selectedCodeFile: file,
      selectedCodeStartLine: startLine ?? null,
      selectedCodeEndLine: endLine ?? startLine ?? null,
      selectedCodeLanguage: language ?? null,
      selectedCodeWorkspaceRoot: workspaceRoot ?? useWorkspaceStore.getState().workspace?.rootPath ?? null,
    });
  },

  clearSelectedCode: () => {
    set({ selectedCode: null, selectedCodeFile: null, selectedCodeStartLine: null, selectedCodeEndLine: null, selectedCodeLanguage: null, selectedCodeWorkspaceRoot: null });
  },

  setMentionFiles: (files) => {
    set({ mentionFiles: [...new Set(files)] });
  },
  removeMentionFile: (file) => {
    set((state) => ({ mentionFiles: state.mentionFiles.filter((item) => item !== file) }));
  },
  clearMentionFiles: () => {
    set({ mentionFiles: [] });
  },

  requestCommandRun: (prompt) => {
    const state = get();
    if (state.isRunning || state.activeRunId !== null || state.pendingApprovalId !== null || prompt.trim() === '') return;
    set({
      isOpen: true,
      prompt,
      mentionFiles: parseMentionPaths(prompt),
      commandRunRequest: {
        id: crypto.randomUUID(),
        prompt,
        workspaceRoot: useWorkspaceStore.getState().workspace?.rootPath ?? null,
      },
    });
  },

  consumeCommandRunRequest: (id) => {
    if (get().commandRunRequest?.id === id) set({ commandRunRequest: null });
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
        terminalCaptureActive = true;
        capturedOutput = '';
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

  run: async (context) => {
    const prompt = get().prompt.trim();
    if (prompt === '') return;
    if (flushTimer !== null) clearTimeout(flushTimer);
    flushTimer = null;
    deltaBuffer = '';
    const workspaceRoot = useWorkspaceStore.getState().workspace?.rootPath ?? '';
    const { activeTab, tabs } = useEditorStore.getState();
    const state = get();
    const selectedBelongsHere = state.selectedCodeWorkspaceRoot === workspaceRoot;
    const selectedCode = context?.selectedCode ?? (selectedBelongsHere ? state.selectedCode : null);
    const selectedCodeFile = context?.selectedCodeFile ?? (selectedBelongsHere ? state.selectedCodeFile : null);
    const runActiveFile = context === undefined ? activeTab : context.activeFile;
    set({ isRunning: true, isCancelling: false, error: null, outcome: null, pendingApprovalId: null, isApproving: false, plan: null, steps: [], commandRunRequest: null });
    // Scroll to bottom so isRunning indicator is visible
    setTimeout(() => {
      const el = document.querySelector('[data-zappr-scroll]');
      if (el instanceof HTMLElement) el.scrollTop = el.scrollHeight;
    }, 50);
    get().addMessage({
      id: crypto.randomUUID(),
      role: 'user',
      content: prompt,
      type: 'chat',
      timestamp: Date.now(),
    });
    const runId = crypto.randomUUID();
    set({ activeRunId: runId });
    const rawMentions = context?.atMentions ?? [...prompt.matchAll(/@([\w./-]+)/g)].map((m) => m[1] ?? '').filter(Boolean);
    const atMentions = [...new Set(rawMentions.map((path) => path.replace(/\\/g, '/').replace(/^\.\//, '')))]
      .filter((path) => path !== '' && !path.startsWith('/') && !path.split('/').includes('..'))
      .filter((path) => path !== selectedCodeFile);
    const smartContextFiles = [...new Set((context?.smartContextFiles ?? [])
      .map((path) => normalizeMentionPath(path))
      .filter((path): path is string => path !== null))]
      .filter((path) => path !== runActiveFile && path !== selectedCodeFile && !atMentions.includes(path))
      .slice(0, 4);
    const openTabs = (context?.openTabs ?? tabs.map((tab) => tab.relPath))
      .filter((path) => path !== runActiveFile && path !== selectedCodeFile && !atMentions.includes(path));
    const result = await invoke('zappr:run', {
      runId,
      prompt,
      workspaceRoot,
      activeFile: atMentions.includes(runActiveFile ?? '') || selectedCodeFile === runActiveFile ? null : runActiveFile,
      openTabs,
      selectedCode,
      selectedCodeFile,
      atMentions,
      smartContextFiles,
    });
    if (get().activeRunId === runId && (!result.ok || !result.value.ok)) {
      set({
        isRunning: false,
        error: result.ok ? (result.value.error ?? 'Zappr failed.') : result.error.message,
      });
    }
  },

  approvePendingPlan: async () => {
    const approvalId = get().pendingApprovalId;
    const runId = get().activeRunId;
    if (approvalId === null || runId === null || get().isApproving) return;
    set({ isApproving: true, isRunning: true, isCancelling: false, error: null });
    const result = await invoke('zappr:approvePlan', { approvalId, runId });
    if (get().activeRunId !== runId) return;
    if (!result.ok || !result.value.ok) {
      const message = result.ok ? (result.value.error ?? 'Could not apply the Zappr plan.') : result.error.message;
      set({
        isApproving: false,
        isRunning: false,
        pendingApprovalId: null,
        error: message.startsWith('Changes reverted after failure:') ? null : message,
      });
    }
  },

  rejectPendingPlan: async () => {
    const approvalId = get().pendingApprovalId;
    const runId = get().activeRunId;
    if (approvalId === null || runId === null) return;
    set({ pendingApprovalId: null, isApproving: false, isRunning: false, isCancelling: false, outcome: { kind: 'rejected', message: 'Changes rejected — no files were modified.' } });
    const result = await invoke('zappr:rejectPlan', { approvalId, runId });
    if (get().activeRunId === runId) set({ activeRunId: null });
    if (!result.ok || !result.value.ok) {
      set({ error: result.ok ? (result.value.error ?? 'Could not reject the Zappr plan.') : result.error.message });
    }
  },

  cancel: async () => {
    const approvalId = get().pendingApprovalId;
    const runId = get().activeRunId;
    if (approvalId !== null) {
      const runId = get().activeRunId;
      await get().rejectPendingPlan();
      if (runId !== null && get().activeRunId === null) {
        set({ outcome: { kind: 'cancelled', message: 'Cancelled — no files were modified.' } });
      }
      return;
    }
    if (runId !== null) {
      set({ isCancelling: true, isRunning: false, isApproving: false });
      await invoke('zappr:cancel', { runId });
    }
  },

  listen: () => {
    const offMode = subscribe('zappr:mode', (payload) => {
      if (payload.runId !== get().activeRunId) return;
      console.warn('[Zappr:UI]', 'zappr:mode', payload);
      set({ mode: payload.mode });
    });
    const offPlan = subscribe('zappr:plan', (payload) => {
      if (payload.runId !== get().activeRunId) return;
      console.warn('[Zappr:UI]', 'zappr:plan', payload);
      const { approvalId, steps, summary } = payload;
      set({
        plan: steps,
        summary,
        steps: steps.map((step) => ({ step, status: 'pending' })),
        pendingApprovalId: approvalId,
        isRunning: false,
        isCancelling: false,
        isApproving: false,
      });
    });
    const offStepStart = subscribe('zappr:stepStart', (payload) => {
      if (payload.runId !== get().activeRunId) return;
      console.warn('[Zappr:UI]', 'zappr:stepStart', payload);
      const { index } = payload;
      set((state) => ({
        currentStep: index,
        steps: state.steps.map((s, i) => (i === index ? { ...s, status: 'running' } : s)),
      }));
    });
    const offStepDone = subscribe('zappr:stepDone', (payload) => {
      if (payload.runId !== get().activeRunId) return;
      console.warn('[Zappr:UI]', 'zappr:stepDone', payload);
      const { index, success } = payload;
      set((state) => ({
        steps: state.steps.map((s, i) => (i === index ? { ...s, status: success ? 'done' : 'error' } : s)),
      }));
    });
    const offDelta = subscribe('zappr:delta', ({ runId, text }) => {
      if (runId !== get().activeRunId) return;
      get().appendDelta(text);
    });
    const offFileProgress = subscribe('zappr:fileProgress', (payload) => {
      if (payload.runId !== get().activeRunId) return;
      console.warn('[Zappr:UI]', 'zappr:fileProgress', payload);
      set({ currentFilePath: payload.filePath, currentFileContent: payload.content });
    });
    const offDone = subscribe('zappr:done', (payload) => {
      if (payload.runId !== get().activeRunId) return;
      console.warn('[Zappr:UI]', 'zappr:done', payload);
      const { chatResponse } = payload;
      const prevStreaming = get().streamingText;
      const prevMode = get().mode;
      const completedRunId = get().activeRunId;
      const outcomeText = payload.error ?? chatResponse ?? '';
      const outcome: ZapprOutcome = payload.success
        ? { kind: 'success', message: chatResponse ?? 'Completed successfully.' }
        : /rollback incomplete|manual review required/i.test(outcomeText)
          ? { kind: 'rollback-incomplete', message: outcomeText }
          : /changes reverted|previous changes were reverted/i.test(outcomeText)
            ? { kind: 'reverted', message: outcomeText }
            : /cancelled/i.test(outcomeText)
              ? { kind: 'cancelled', message: /reverted/i.test(outcomeText) ? 'Cancelled — changes were reverted.' : 'Cancelled — no files were modified.' }
              : { kind: 'error', message: outcomeText || 'Zappr failed.' };
      set({
        isRunning: false,
        isApproving: false,
        pendingApprovalId: null,
        activeRunId: null,
        ...(payload.error !== undefined ? { error: payload.error } : {}),
        currentFilePath: null,
        currentFileContent: null,
        ...(chatResponse !== undefined ? { chatResponse, streamingText: '' } : {}),
        outcome,
      });
      const content = chatResponse ?? prevStreaming;
      if (content !== '' && completedRunId !== null) {
        const prevSteps = get().steps;
        const prevTerminalCommand = get().lastTerminalCommand;
        const prevTerminalOutput = get().lastTerminalOutput;
        get().addMessage({
          id: crypto.randomUUID(),
          role: 'assistant',
          content,
          type: prevMode === null || prevMode === 'math' ? 'chat' : prevMode,
          steps: prevSteps.map(({ step, status }) => ({
            filePath: step.filePath,
            type: step.type,
            description: step.description,
            status,
          })),
          ...(prevTerminalCommand !== null ? { terminalCommand: prevTerminalCommand } : {}),
          ...(prevTerminalOutput !== null ? { terminalOutput: prevTerminalOutput } : {}),
          timestamp: Date.now(),
        });
      }
    });
    const offActionResult = subscribe('zappr:actionResult', (payload) => {
      if (payload.runId !== get().activeRunId) return;
      console.warn('[Zappr:UI]', 'zappr:actionResult', payload);
      const { message, action } = payload;
      set({ chatResponse: message, isRunning: false, pendingAction: action });
      void get()
        .executeAction(action)
        .then((result) => {
          console.warn('[Zappr:UI] Action result', result);
          if (result !== null && get().activeRunId === payload.runId) set({ chatResponse: result });
        });
    });
    const offTerminalData = subscribe('terminal:data', (payload) => {
      if (!terminalCaptureActive) return;
      // Strip ANSI escape codes
      // eslint-disable-next-line no-control-regex -- \x1b (ESC) is the ANSI escape-sequence marker
      const clean = payload.data.replace(/\x1b\[[0-9;]*[mGKHF]/g, '').replace(/\r/g, '');
      capturedOutput += clean;
      // Debounce — wait 500ms after last output before finalizing
      if (captureTimer !== null) clearTimeout(captureTimer);
      captureTimer = setTimeout(() => {
        set({ lastTerminalOutput: capturedOutput.trim() });
        capturedOutput = '';
        terminalCaptureActive = false;
      }, 500);
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
      offTerminalData();
    };
  },
}));
