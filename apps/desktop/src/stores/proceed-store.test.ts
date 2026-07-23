import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Proceed Mode's renderer wiring (P2.2R). These pin the contract that makes Proceed safe in the app:
 * a proposal only ever reaches preview after main verified it, Accept goes through the SAME
 * `ai:applyRepair` write path Repair uses (range + expectedOriginal), Cancel writes nothing, and a
 * verification refusal is surfaced to the user rather than silently applied.
 */

const invoke = vi.hoisted(() => vi.fn());
const refreshModelText = vi.hoisted(() => vi.fn());
const findingsRefresh = vi.hoisted(() => vi.fn());
const activeCursorLine = vi.hoisted(() => vi.fn((): number | null => 12));
const activeSelectionRange = vi.hoisted(() =>
  vi.fn(() => null as { startLine: number; endLine: number } | null),
);

vi.mock('../lib/bridge.js', () => ({ invoke, subscribe: () => () => undefined }));
vi.mock('../features/editor/models.js', () => ({ refreshModelText }));
vi.mock('../features/editor/active-editor.js', () => ({ activeCursorLine, activeSelectionRange }));
vi.mock('../features/editor/editor-store.js', () => ({
  useEditorStore: { getState: () => ({ activeTab: 'src/Button.tsx' }) },
}));
vi.mock('../features/findings/findings-store.js', () => ({
  useFindingsStore: { getState: () => ({ refresh: findingsRefresh }) },
}));

const { useProceedStore } = await import('./proceed-store.js');

const proposal = {
  intent: 'styling' as const,
  editedCode: 'export const B = () => <button className="green" />;',
  originalCode: 'export const B = () => <button />;',
  summary: 'Made the button green.',
  confidence: 0.9,
  target: { file: 'src/Button.tsx', startLine: 1, endLine: 1, symbolName: 'B' },
  verification: {
    verdict: 'verified' as const,
    targetResolved: true,
    newFindingCount: 0,
    syntaxOk: true,
    ran: ['syntax'],
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  useProceedStore.setState({
    status: 'idle',
    proposal: null,
    message: null,
    blocked: null,
    applying: false,
  });
  activeSelectionRange.mockReturnValue(null);
  activeCursorLine.mockReturnValue(12);
});

describe('proceed store — run', () => {
  it('sends the instruction with the caret line and shows the verified proposal for preview', async () => {
    invoke.mockResolvedValueOnce({ ok: true, value: { status: 'ok', proposal } });
    await useProceedStore.getState().run('make this button green');

    expect(invoke).toHaveBeenCalledWith('proceed:run', {
      instruction: 'make this button green',
      file: 'src/Button.tsx',
      selectionStartLine: 12,
    });
    expect(useProceedStore.getState().status).toBe('preview');
    expect(useProceedStore.getState().proposal?.summary).toBe('Made the button green.');
  });

  it('prefers a real selection range over the bare caret', async () => {
    activeSelectionRange.mockReturnValue({ startLine: 4, endLine: 9 });
    invoke.mockResolvedValueOnce({ ok: true, value: { status: 'ok', proposal } });
    await useProceedStore.getState().run('rename this variable');
    expect(invoke).toHaveBeenCalledWith(
      'proceed:run',
      expect.objectContaining({ selectionStartLine: 4, selectionEndLine: 9 }),
    );
  });

  it('surfaces a verification refusal instead of applying it', async () => {
    invoke.mockResolvedValueOnce({
      ok: true,
      value: { status: 'rejected', reason: 'The edit introduces 1 new problem(s).' },
    });
    await useProceedStore.getState().run('make this button green');
    expect(useProceedStore.getState().status).toBe('error');
    expect(useProceedStore.getState().message).toContain('rejected by verification');
    expect(useProceedStore.getState().proposal).toBeNull();
  });

  it('fails gracefully on an unknown intent, with no proposal', async () => {
    invoke.mockResolvedValueOnce({
      ok: true,
      value: {
        status: 'unknown-intent',
        message: 'I could not tell what kind of change you want.',
      },
    });
    await useProceedStore.getState().run('asdf qwerty');
    expect(useProceedStore.getState().status).toBe('error');
    expect(useProceedStore.getState().proposal).toBeNull();
  });

  it('refuses to run with no file open — never guesses a target', async () => {
    const mod = await import('../features/editor/editor-store.js');
    vi.spyOn(mod.useEditorStore, 'getState').mockReturnValue({ activeTab: null } as never);
    await useProceedStore.getState().run('make this green');
    expect(invoke).not.toHaveBeenCalled();
    expect(useProceedStore.getState().status).toBe('error');
  });
});

describe('proceed store — accept / cancel', () => {
  it('ACCEPT applies through ai:applyRepair with the range + expectedOriginal, then refreshes', async () => {
    useProceedStore.setState({ status: 'preview', proposal });
    invoke
      .mockResolvedValueOnce({ ok: true, value: { applied: true } }) // ai:applyRepair
      .mockResolvedValueOnce({ ok: true, value: { file: { content: 'new content' } } }); // fs:readFile

    const ok = await useProceedStore.getState().accept();

    expect(ok).toBe(true);
    expect(invoke).toHaveBeenNthCalledWith(1, 'ai:applyRepair', {
      file: 'src/Button.tsx',
      startLine: 1,
      endLine: 1,
      code: proposal.editedCode,
      expectedOriginal: proposal.originalCode, // stale-range guard input
    });
    expect(refreshModelText).toHaveBeenCalledWith('src/Button.tsx', 'new content');
    expect(findingsRefresh).toHaveBeenCalled(); // diagnostics/findings/decorations follow
    expect(useProceedStore.getState().status).toBe('idle');
  });

  it('ACCEPT surfaces a refused apply (e.g. stale range) and keeps the preview state honest', async () => {
    useProceedStore.setState({ status: 'preview', proposal });
    invoke.mockResolvedValueOnce({ ok: true, value: { applied: false, message: 'stale-range' } });
    const ok = await useProceedStore.getState().accept();
    expect(ok).toBe(false);
    expect(useProceedStore.getState().message).toBe('stale-range');
    expect(refreshModelText).not.toHaveBeenCalled();
  });

  it('CANCEL discards the proposal and writes nothing', () => {
    useProceedStore.setState({ status: 'preview', proposal });
    useProceedStore.getState().cancel();
    expect(invoke).not.toHaveBeenCalled();
    expect(useProceedStore.getState().proposal).toBeNull();
    expect(useProceedStore.getState().status).toBe('idle');
  });
});
