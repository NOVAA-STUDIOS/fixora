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
// A minimal fake of the editor store's `subscribe` contract (state, prevState), so proceed-store's
// tab-change guard (Q3 Defect #2) can be driven from tests exactly as the real zustand store would
// drive it — not a plain getter mock, which has no subscribe surface at all.
interface FakeEditorState {
  activeTab: string | null;
}
const editorState: FakeEditorState = vi.hoisted(() => ({ activeTab: 'src/Button.tsx' }));
const editorListeners = vi.hoisted(
  () => [] as ((state: typeof editorState, prev: typeof editorState) => void)[],
);

vi.mock('../lib/bridge.js', () => ({ invoke, subscribe: () => () => undefined }));
vi.mock('../features/editor/models.js', () => ({ refreshModelText }));
vi.mock('../features/editor/active-editor.js', () => ({ activeCursorLine, activeSelectionRange }));
vi.mock('../features/editor/editor-store.js', () => ({
  useEditorStore: {
    getState: () => editorState,
    subscribe: (listener: (state: typeof editorState, prev: typeof editorState) => void) => {
      editorListeners.push(listener);
      return () => {
        const i = editorListeners.indexOf(listener);
        if (i >= 0) editorListeners.splice(i, 1);
      };
    },
  },
}));
vi.mock('../features/findings/findings-store.js', () => ({
  useFindingsStore: { getState: () => ({ refresh: findingsRefresh }) },
}));

const { useProceedStore } = await import('./proceed-store.js');

/** Simulate the renderer switching the active editor tab, firing proceed-store's guard. */
function setActiveTab(next: string | null): void {
  const prev = { ...editorState };
  editorState.activeTab = next;
  for (const listener of editorListeners) listener({ ...editorState }, prev);
}

/** A promise whose resolution is controlled externally — for asserting state mid-flight. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

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
    retryable: false,
    lastRequest: null,
  });
  // Reset directly (not via setActiveTab) — a real reset, not a "switch" that should fire the guard.
  editorState.activeTab = 'src/Button.tsx';
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
    editorState.activeTab = null; // reset by the next test's beforeEach — not a leaked spy
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

  it('ACCEPT surfaces a write-verification failure from main, never treated as success (Q3 hardening)', async () => {
    useProceedStore.setState({ status: 'preview', proposal });
    invoke.mockResolvedValueOnce({
      ok: true,
      value: {
        applied: false,
        reason: 'write-failed',
        message:
          'Fixora wrote src/Button.tsx, but reading it back shows different bytes than what was ' +
          'written. This looks like a data-integrity problem, not a normal failure, so the change ' +
          'was NOT recorded as applied.',
      },
    });
    const ok = await useProceedStore.getState().accept();
    expect(ok).toBe(false);
    expect(useProceedStore.getState().message).toContain('data-integrity problem');
    expect(useProceedStore.getState().status).toBe('error');
    // "Reflect the applied edit" (buffer refresh + findings refresh) must never run for a failed apply.
    expect(refreshModelText).not.toHaveBeenCalled();
    expect(findingsRefresh).not.toHaveBeenCalled();
    expect(invoke).toHaveBeenCalledTimes(1); // ai:applyRepair only
  });

  it('CANCEL discards the proposal and writes nothing (no ai:applyRepair, ever)', async () => {
    useProceedStore.setState({ status: 'preview', proposal });
    await useProceedStore.getState().cancel();
    // Cancel always reaches main's cancel channel (Q3 Defect #4) — harmless here since nothing is
    // running in `preview` — but it must NEVER be the write path.
    expect(invoke).not.toHaveBeenCalledWith('ai:applyRepair', expect.anything());
    expect(useProceedStore.getState().proposal).toBeNull();
    expect(useProceedStore.getState().status).toBe('idle');
  });
});

describe('proceed store — proposal is scoped to its file (Q3 Defect #2)', () => {
  it('1. a proposal generated for File A cannot be Accepted after switching to File B', () => {
    // proposal.target.file is src/Button.tsx (see fixture above).
    useProceedStore.setState({ status: 'preview', proposal });
    setActiveTab('src/Other.tsx');

    expect(useProceedStore.getState().proposal).toBeNull();
    expect(useProceedStore.getState().status).toBe('idle');
  });

  it('3. switching files discards the proposal so Accept cannot write to the wrong file', async () => {
    useProceedStore.setState({ status: 'preview', proposal });
    setActiveTab('src/Other.tsx');

    const ok = await useProceedStore.getState().accept();

    expect(ok).toBe(false);
    expect(invoke).not.toHaveBeenCalled(); // ai:applyRepair never reached — nothing to apply
  });

  it('2. a same-file proposal is untouched by tab churn that stays on (or returns to) its own file', () => {
    useProceedStore.setState({ status: 'preview', proposal });
    setActiveTab('src/Button.tsx'); // no real change
    expect(useProceedStore.getState().proposal).not.toBeNull();
    expect(useProceedStore.getState().status).toBe('preview');

    setActiveTab('src/Other.tsx');
    setActiveTab('src/Button.tsx'); // back to the proposal's own file
    // Once discarded by the switch away, it stays discarded — switching back does not resurrect a
    // proposal for content that may have moved on; the user must re-run Proceed. This assertion pins
    // that "discarded" is a one-way transition, not a toggle.
    expect(useProceedStore.getState().proposal).toBeNull();
  });

  it('does not discard the proposal while status is not preview (idle/running/error are untouched)', () => {
    useProceedStore.setState({ status: 'running', proposal: null });
    setActiveTab('src/Other.tsx');
    expect(useProceedStore.getState().status).toBe('running');
  });

  it('a proposal that lands AFTER the user already switched tabs mid-flight is never shown as valid', async () => {
    // The request for src/Button.tsx is in flight; the user switches to src/Other.tsx before main
    // replies. The reply — a verified proposal for src/Button.tsx — must not become an acceptable
    // preview for whatever file happens to be active when it arrives.
    invoke.mockImplementationOnce(() => {
      setActiveTab('src/Other.tsx');
      return Promise.resolve({ ok: true, value: { status: 'ok', proposal } });
    });

    await useProceedStore.getState().run('make this button green');

    expect(useProceedStore.getState().proposal).toBeNull();
    expect(useProceedStore.getState().status).toBe('error');
    expect(useProceedStore.getState().message).toMatch(/switched files/i);
  });

  it('4. the expectedOriginal staleness guard still runs unmodified for a same-file Accept', async () => {
    useProceedStore.setState({ status: 'preview', proposal });
    invoke.mockResolvedValueOnce({ ok: true, value: { applied: false, message: 'stale-range' } });
    const ok = await useProceedStore.getState().accept();
    expect(ok).toBe(false);
    expect(invoke).toHaveBeenCalledWith(
      'ai:applyRepair',
      expect.objectContaining({ expectedOriginal: proposal.originalCode }),
    );
    expect(useProceedStore.getState().message).toBe('stale-range');
  });

  it('5. normal same-file Proceed → preview → Accept is unchanged', async () => {
    invoke
      .mockResolvedValueOnce({ ok: true, value: { status: 'ok', proposal } }) // proceed:run
      .mockResolvedValueOnce({ ok: true, value: { applied: true } }) // ai:applyRepair
      .mockResolvedValueOnce({ ok: true, value: { file: { content: 'new content' } } }); // fs:readFile

    await useProceedStore.getState().run('make this button green');
    expect(useProceedStore.getState().status).toBe('preview');

    const ok = await useProceedStore.getState().accept();
    expect(ok).toBe(true);
    expect(useProceedStore.getState().status).toBe('idle');
    expect(findingsRefresh).toHaveBeenCalled();
  });
});

describe('proceed store — retry replays the exact failed request (Q3 Defect #3)', () => {
  it('1. retry after switching tabs still targets the file the failed request was for', async () => {
    invoke.mockResolvedValueOnce({ ok: false, error: { message: 'network blip' } }); // transport failure
    await useProceedStore.getState().run('make this button green');
    expect(useProceedStore.getState().retryable).toBe(true);

    setActiveTab('src/Other.tsx'); // switch away AFTER the failure, before clicking Retry

    invoke.mockResolvedValueOnce({ ok: true, value: { status: 'ok', proposal } });
    await useProceedStore.getState().retry();

    expect(invoke).toHaveBeenLastCalledWith(
      'proceed:run',
      expect.objectContaining({ file: 'src/Button.tsx' }), // NOT src/Other.tsx
    );
  });

  it('2. retry after moving the cursor/changing the selection still uses the original selection', async () => {
    activeCursorLine.mockReturnValue(12);
    invoke.mockResolvedValueOnce({ ok: false, error: { message: 'network blip' } });
    await useProceedStore.getState().run('make this button green');

    // The cursor/selection moved after the failure, before Retry is clicked.
    activeCursorLine.mockReturnValue(999);
    activeSelectionRange.mockReturnValue({ startLine: 50, endLine: 60 });

    invoke.mockResolvedValueOnce({ ok: true, value: { status: 'ok', proposal } });
    await useProceedStore.getState().retry();

    expect(invoke).toHaveBeenLastCalledWith('proceed:run', {
      instruction: 'make this button green',
      file: 'src/Button.tsx',
      selectionStartLine: 12, // the ORIGINAL caret, not the moved one
      // no selectionEndLine: the original request had no selection, only a caret
    });
  });

  it('3. retry preserves the exact original instruction text, unchanged', async () => {
    invoke.mockResolvedValueOnce({ ok: false, error: { message: 'network blip' } });
    await useProceedStore.getState().run('rename this variable to `total`');

    invoke.mockResolvedValueOnce({ ok: true, value: { status: 'ok', proposal } });
    await useProceedStore.getState().retry();

    expect(invoke).toHaveBeenLastCalledWith(
      'proceed:run',
      expect.objectContaining({ instruction: 'rename this variable to `total`' }),
    );
  });

  it('4. a non-retryable failure (verification rejection) leaves retryable false', async () => {
    invoke.mockResolvedValueOnce({
      ok: true,
      value: { status: 'rejected', reason: 'The edit introduces 1 new problem(s).' },
    });
    await useProceedStore.getState().run('make this button green');
    expect(useProceedStore.getState().retryable).toBe(false);
  });

  it('7. an independent later run() replaces the retry target — no stale request leaks across cycles', async () => {
    // Cycle 1: fails on File A, is retried, fails again.
    invoke.mockResolvedValueOnce({ ok: false, error: { message: 'blip 1' } });
    await useProceedStore.getState().run('make this button green'); // file: src/Button.tsx
    invoke.mockResolvedValueOnce({ ok: false, error: { message: 'blip 2' } });
    await useProceedStore.getState().retry();
    expect(invoke).toHaveBeenLastCalledWith(
      'proceed:run',
      expect.objectContaining({ file: 'src/Button.tsx' }),
    );

    // Cycle 2: the user moves to a different file entirely and starts a FRESH request (not a retry).
    setActiveTab('src/Other.tsx');
    invoke.mockResolvedValueOnce({ ok: false, error: { message: 'blip 3' } });
    await useProceedStore.getState().run('add error handling');

    // Retry now must replay Cycle 2's request — not the stale one from Cycle 1.
    invoke.mockResolvedValueOnce({ ok: true, value: { status: 'ok', proposal } });
    await useProceedStore.getState().retry();
    expect(invoke).toHaveBeenLastCalledWith('proceed:run', {
      instruction: 'add error handling',
      file: 'src/Other.tsx',
      selectionStartLine: 12,
    });

    // Cycle 3: that succeeds and is Accepted — the completed cycle must not resurrect Cycle 1's state.
    expect(useProceedStore.getState().status).toBe('preview');
  });

  it('does not resend when there is no captured request to replay', async () => {
    await useProceedStore.getState().retry();
    expect(invoke).not.toHaveBeenCalled();
  });
});

describe('proceed store — real in-flight cancellation (Q3 Defect #4)', () => {
  it('1. a real Cancel action exists and reaches the actual in-flight request', async () => {
    const runDeferred = deferred<{
      ok: true;
      value: { status: 'ok'; proposal: typeof proposal };
    }>();
    invoke.mockImplementationOnce(() => runDeferred.promise); // proceed:run — never resolves in this test
    invoke.mockResolvedValueOnce({ ok: true, value: undefined }); // proceed:cancel

    const runPromise = useProceedStore.getState().run('make this button green');
    expect(useProceedStore.getState().status).toBe('running');

    await useProceedStore.getState().cancel();

    // Not a UI-only dismissal — the actual IPC cancel channel main uses to abort the provider
    // request was invoked, not merely a local state reset.
    expect(invoke).toHaveBeenCalledWith('proceed:cancel', {});
    expect(useProceedStore.getState().status).toBe('idle');
    expect(useProceedStore.getState().proposal).toBeNull();

    runDeferred.resolve({ ok: true, value: { status: 'ok', proposal } }); // let the stale promise settle
    await runPromise;
  });

  it('2. cancel before the provider responds leaves no proposal when the late reply finally arrives', async () => {
    const runDeferred = deferred<{
      ok: true;
      value: { status: 'ok'; proposal: typeof proposal };
    }>();
    invoke.mockImplementationOnce(() => runDeferred.promise);
    invoke.mockResolvedValueOnce({ ok: true, value: undefined });

    const runPromise = useProceedStore.getState().run('make this button green');
    await useProceedStore.getState().cancel();

    // The cancelled request's response arrives LATE, after Cancel already settled the UI to idle.
    runDeferred.resolve({ ok: true, value: { status: 'ok', proposal } });
    await runPromise;

    expect(useProceedStore.getState().status).toBe('idle');
    expect(useProceedStore.getState().proposal).toBeNull(); // no proposal ever appears
  });

  it('3. cancel while "streaming" discards a late cancellation echo from main without flipping to error', async () => {
    const runDeferred = deferred<{
      ok: true;
      value: { status: 'error'; code: 'cancelled'; message: string };
    }>();
    invoke.mockImplementationOnce(() => runDeferred.promise);
    invoke.mockResolvedValueOnce({ ok: true, value: undefined });

    const runPromise = useProceedStore.getState().run('make this button green');
    await useProceedStore.getState().cancel();

    // main's own "cancelled" outcome (proceed-service.ts's abort branch) arrives after the fact.
    runDeferred.resolve({
      ok: true,
      value: { status: 'error', code: 'cancelled', message: 'Cancelled.' },
    });
    await runPromise;

    // Must stay idle — a stale "Cancelled." error must not resurrect as a visible error state.
    expect(useProceedStore.getState().status).toBe('idle');
    expect(useProceedStore.getState().message).toBeNull();
  });

  it('4. a provider completion racing almost simultaneously with Cancel still loses to Cancel', async () => {
    invoke
      .mockResolvedValueOnce({ ok: true, value: { status: 'ok', proposal } }) // proceed:run resolves fast
      .mockResolvedValueOnce({ ok: true, value: undefined }); // proceed:cancel

    // Neither awaited individually — this is the "arrived at nearly the same time" case. Cancel's
    // token bump is synchronous, so it wins regardless of how quickly proceed:run's promise settles.
    const runPromise = useProceedStore.getState().run('make this button green');
    const cancelPromise = useProceedStore.getState().cancel();
    await Promise.all([runPromise, cancelPromise]);

    expect(useProceedStore.getState().status).toBe('idle');
    expect(useProceedStore.getState().proposal).toBeNull();
  });

  it('5. a fresh Proceed request after cancelling runs normally and is not blocked by the cancelled one', async () => {
    const staleDeferred = deferred<{
      ok: true;
      value: { status: 'ok'; proposal: typeof proposal };
    }>();
    invoke.mockImplementationOnce(() => staleDeferred.promise);
    invoke.mockResolvedValueOnce({ ok: true, value: undefined }); // proceed:cancel

    const stalePromise = useProceedStore.getState().run('make this button green');
    await useProceedStore.getState().cancel();

    const freshProposal = { ...proposal, summary: 'A fresh, different edit.' };
    invoke.mockResolvedValueOnce({ ok: true, value: { status: 'ok', proposal: freshProposal } });
    await useProceedStore.getState().run('add error handling');

    expect(useProceedStore.getState().status).toBe('preview');
    expect(useProceedStore.getState().proposal?.summary).toBe('A fresh, different edit.');

    // The stale, cancelled request's late reply must not overwrite the fresh, valid preview.
    staleDeferred.resolve({ ok: true, value: { status: 'ok', proposal } });
    await stalePromise;
    expect(useProceedStore.getState().proposal?.summary).toBe('A fresh, different edit.');
  });

  it('cancel only touches Proceed state — never calls ai:applyRepair or any Repair channel', async () => {
    invoke.mockResolvedValueOnce({ ok: true, value: undefined }); // proceed:cancel
    useProceedStore.setState({ status: 'running' });
    await useProceedStore.getState().cancel();
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith('proceed:cancel', {});
    expect(invoke).not.toHaveBeenCalledWith('ai:cancel', expect.anything());
    expect(invoke).not.toHaveBeenCalledWith('ai:applyRepair', expect.anything());
  });

  it('Defect #1/#2/#3 protections are unaffected by cancellation', async () => {
    // #1: explanation-intent style refusals still short-circuit before anything resembling a run.
    invoke.mockResolvedValueOnce({
      ok: true,
      value: { status: 'unknown-intent', message: 'That reads like a question, not a change.' },
    });
    await useProceedStore.getState().run('explain what this does');
    expect(useProceedStore.getState().status).toBe('error');
    expect(useProceedStore.getState().proposal).toBeNull();

    // #2: a proposal is still discarded on a tab switch, cancel() or not in the mix.
    useProceedStore.setState({ status: 'preview', proposal });
    setActiveTab('src/Other.tsx');
    expect(useProceedStore.getState().proposal).toBeNull();
    editorState.activeTab = 'src/Button.tsx';

    // #3: retry still replays the pinned request, not live editor state.
    invoke.mockResolvedValueOnce({ ok: false, error: { message: 'blip' } });
    await useProceedStore.getState().run('rename this variable');
    setActiveTab('src/Other.tsx');
    invoke.mockResolvedValueOnce({ ok: true, value: { status: 'ok', proposal } });
    await useProceedStore.getState().retry();
    expect(invoke).toHaveBeenLastCalledWith(
      'proceed:run',
      expect.objectContaining({ file: 'src/Button.tsx', instruction: 'rename this variable' }),
    );
  });
});
