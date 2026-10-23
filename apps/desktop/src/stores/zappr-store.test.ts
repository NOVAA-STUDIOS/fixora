import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useEditorStore } from '../features/editor/editor-store.js';

import { useZapprStore } from './zappr-store.js';

const listeners = new Map<string, (payload: unknown) => void>();
let stopListening: (() => void) | null = null;
const invokeMock = vi.fn();

beforeEach(() => {
  listeners.clear();
  Object.defineProperty(window, 'fixora', {
    configurable: true,
    value: {
      invoke: invokeMock,
      subscribe: (channel: string, listener: (payload: unknown) => void) => {
        listeners.set(channel, listener);
        return () => listeners.delete(channel);
      },
    },
  });
  useZapprStore.setState({
    activeRunId: null,
    isRunning: false,
    isCancelling: false,
    streamingText: '',
    chatResponse: null,
    pendingApprovalId: null,
    steps: [],
    outcome: null,
    prompt: 'explain this',
    selectedCode: null,
    selectedCodeFile: null,
    selectedCodeStartLine: null,
    selectedCodeEndLine: null,
    selectedCodeLanguage: null,
    selectedCodeWorkspaceRoot: null,
    mentionFiles: [],
    commandRunRequest: null,
  });
  invokeMock.mockReset();
  invokeMock.mockResolvedValue({ ok: true, value: { ok: true } });
  stopListening = useZapprStore.getState().listen();
});

describe('Zappr outcome presentation state', () => {
  it('records a neutral rejected outcome without file changes', async () => {
    const runId = crypto.randomUUID();
    useZapprStore.setState({ activeRunId: runId, pendingApprovalId: 'approval-1', isRunning: true });

    await useZapprStore.getState().rejectPendingPlan();

    expect(useZapprStore.getState().outcome).toEqual({
      kind: 'rejected',
      message: 'Changes rejected — no files were modified.',
    });
  });

  it('records rollback-incomplete as a non-success outcome', () => {
    const runId = crypto.randomUUID();
    useZapprStore.setState({ activeRunId: runId, isRunning: true });

    listeners.get('zappr:done')?.({
      runId,
      success: false,
      filesChanged: [],
      chatResponse: 'Rollback incomplete after failure. Manual review required.',
    });

    expect(useZapprStore.getState().outcome?.kind).toBe('rollback-incomplete');
  });

  it('keeps cancellation status scoped to the active run', async () => {
    const runId = crypto.randomUUID();
    useZapprStore.setState({ activeRunId: runId, isRunning: true });

    await useZapprStore.getState().cancel();

    expect(useZapprStore.getState().isCancelling).toBe(true);
    expect(invokeMock).toHaveBeenCalledWith('zappr:cancel', { runId });
  });
});

describe('Zappr explicit mention state', () => {
  it('keeps file chips derived from the composed prompt', () => {
    useZapprStore.getState().setPrompt('Compare @src/a.ts with @src/b.ts and @src/a.ts');
    expect(useZapprStore.getState().mentionFiles).toEqual(['src/a.ts', 'src/b.ts']);
    useZapprStore.getState().setPrompt('No file context');
    expect(useZapprStore.getState().mentionFiles).toEqual([]);
  });

  it('deduplicates and removes mention chips independently from selection context', () => {
    const store = useZapprStore.getState();
    store.captureSelection({ code: 'selected', file: 'src/selected.ts', startLine: 2, endLine: 4 });
    store.setMentionFiles(['src/other.ts', 'src/other.ts', 'tests/other.test.ts']);
    store.removeMentionFile('src/other.ts');

    expect(useZapprStore.getState().mentionFiles).toEqual(['tests/other.test.ts']);
    expect(useZapprStore.getState().selectedCodeFile).toBe('src/selected.ts');
  });

  it('keeps the submitted active-file context after a later tab switch', async () => {
    const context = {
      activeFile: 'src/original.ts',
      openTabs: [],
      selectedCode: null,
      selectedCodeFile: null,
      atMentions: [],
    };
    const pending = useZapprStore.getState().run(context);
    useEditorStore.getState().setActive('src/later.ts');
    await pending;

    expect(invokeMock).toHaveBeenCalledWith('zappr:run', expect.objectContaining({
      activeFile: 'src/original.ts',
      openTabs: [],
    }));
  });

  it('suppresses active-file fallback when that file is selected or explicitly mentioned', async () => {
    const pending = useZapprStore.getState().run({
      activeFile: 'src/current.ts',
      openTabs: ['src/current.ts'],
      selectedCode: null,
      selectedCodeFile: null,
      atMentions: ['src/current.ts'],
    });
    await pending;

    expect(invokeMock).toHaveBeenCalledWith('zappr:run', expect.objectContaining({
      activeFile: null,
      atMentions: ['src/current.ts'],
    }));
  });

  it('snapshots only safe, non-duplicate Smart Context paths into the run request', async () => {
    const pending = useZapprStore.getState().run({
      activeFile: 'src/current.ts',
      openTabs: [],
      selectedCode: null,
      selectedCodeFile: null,
      atMentions: ['src/explicit.ts'],
      smartContextFiles: ['src/current.ts', 'src/explicit.ts', 'src/auto.ts', 'C:\\outside.ts', '../outside.ts'],
    });
    await pending;

    expect(invokeMock).toHaveBeenCalledWith('zappr:run', expect.objectContaining({
      smartContextFiles: ['src/auto.ts'],
    }));
  });
});

describe('Zappr command palette handoff', () => {
  it('queues a transient prompt for the existing panel submit path without invoking a second backend', () => {
    useZapprStore.getState().requestCommandRun('Review this file.');
    const request = useZapprStore.getState().commandRunRequest;
    expect(request).toMatchObject({ prompt: 'Review this file.' });
    expect(request?.id).toEqual(expect.any(String));
    expect(useZapprStore.getState().isOpen).toBe(true);
    expect(invokeMock).not.toHaveBeenCalled();

    if (request !== null) useZapprStore.getState().consumeCommandRunRequest(request.id);
    expect(useZapprStore.getState().commandRunRequest).toBeNull();
  });

  it('does not queue an AI action while a run or approval is active', () => {
    useZapprStore.setState({ activeRunId: crypto.randomUUID(), isRunning: true });
    useZapprStore.getState().requestCommandRun('Fix errors in the active file.');
    expect(useZapprStore.getState().commandRunRequest).toBeNull();
    expect(invokeMock).not.toHaveBeenCalled();
  });
});

afterEach(() => {
  stopListening?.();
  stopListening = null;
});

describe('Zappr stale event isolation', () => {
  it('captures and replaces exact selection context', () => {
    const store = useZapprStore.getState();
    store.captureSelection({ code: 'const a = 1;', file: 'src/a.ts', startLine: 4, endLine: 6, language: 'typescript' });
    expect(useZapprStore.getState()).toMatchObject({
      selectedCode: 'const a = 1;', selectedCodeFile: 'src/a.ts', selectedCodeStartLine: 4, selectedCodeEndLine: 6,
    });
    store.captureSelection({ code: 'const b = 2;', file: 'src/b.ts', startLine: 1, endLine: 1 });
    expect(useZapprStore.getState()).toMatchObject({ selectedCode: 'const b = 2;', selectedCodeFile: 'src/b.ts', selectedCodeStartLine: 1 });
    store.clearSelectedCode();
    expect(useZapprStore.getState().selectedCode).toBeNull();
  });

  it('ignores late delta and done events from an older run', () => {
    const oldRunId = crypto.randomUUID();
    const activeRunId = crypto.randomUUID();
    useZapprStore.setState({ activeRunId, isRunning: true, streamingText: 'current' });

    listeners.get('zappr:delta')?.({ runId: oldRunId, text: ' stale' });
    listeners.get('zappr:done')?.({
      runId: oldRunId,
      success: true,
      filesChanged: [],
      chatResponse: 'stale success',
    });

    expect(useZapprStore.getState().activeRunId).toBe(activeRunId);
    expect(useZapprStore.getState().isRunning).toBe(true);
    expect(useZapprStore.getState().streamingText).toBe('current');
    expect(useZapprStore.getState().chatResponse).not.toBe('stale success');
  });
});
