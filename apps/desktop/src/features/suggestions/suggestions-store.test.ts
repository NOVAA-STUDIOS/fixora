import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The renderer store's job is entirely translation: call the bridge, shape the result into state.
 * The bridge is mocked (as `ai-store.test.ts` and `history-store` tests do elsewhere) so these pin
 * the store's own logic — optimistic list update on submit, error surfacing, cancel-safe export —
 * without a real IPC round-trip.
 */

const invoke = vi.hoisted(() => vi.fn());

vi.mock('../../lib/bridge.js', () => ({ invoke, subscribe: () => () => undefined }));

const { useSuggestionsStore } = await import('./suggestions-store.js');

const suggestion = {
  id: 's1',
  category: 'feature' as const,
  message: 'Add dark mode',
  createdAt: 1000,
};

beforeEach(() => {
  vi.clearAllMocks();
  useSuggestionsStore.setState({
    suggestions: [],
    loaded: false,
    submitting: false,
    error: null,
  });
});

describe('useSuggestionsStore', () => {
  it('refresh loads the list and marks it loaded', async () => {
    invoke.mockResolvedValueOnce({ ok: true, value: { suggestions: [suggestion] } });
    await useSuggestionsStore.getState().refresh();
    expect(useSuggestionsStore.getState().suggestions).toEqual([suggestion]);
    expect(useSuggestionsStore.getState().loaded).toBe(true);
  });

  it('refresh degrades to an empty list (never throws) on a failed call', async () => {
    invoke.mockResolvedValueOnce({
      ok: false,
      error: { code: 'IPC_HANDLER_FAILED', message: 'nope', action: { type: 'none', label: '' } },
    });
    await useSuggestionsStore.getState().refresh();
    expect(useSuggestionsStore.getState().suggestions).toEqual([]);
    expect(useSuggestionsStore.getState().loaded).toBe(true);
  });

  it('submit prepends the new suggestion on success and returns true', async () => {
    invoke.mockResolvedValueOnce({ ok: true, value: { suggestion } });
    const ok = await useSuggestionsStore.getState().submit('feature', 'Add dark mode');
    expect(ok).toBe(true);
    expect(useSuggestionsStore.getState().suggestions).toEqual([suggestion]);
    expect(useSuggestionsStore.getState().submitting).toBe(false);
    expect(invoke).toHaveBeenCalledWith('suggestions:submit', {
      category: 'feature',
      message: 'Add dark mode',
    });
  });

  it('submit sets `submitting` true for the duration of the call', async () => {
    let resolveInvoke: (v: unknown) => void = () => undefined;
    invoke.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveInvoke = resolve;
      }),
    );
    const promise = useSuggestionsStore.getState().submit('feature', 'Add dark mode');
    expect(useSuggestionsStore.getState().submitting).toBe(true);
    resolveInvoke({ ok: true, value: { suggestion } });
    await promise;
    expect(useSuggestionsStore.getState().submitting).toBe(false);
  });

  it('submit surfaces the server error and returns false without touching the list', async () => {
    invoke.mockResolvedValueOnce({
      ok: false,
      error: {
        code: 'IPC_HANDLER_FAILED',
        message: 'Your suggestion is too short.',
        action: { type: 'none', label: 'Dismiss' },
      },
    });
    const ok = await useSuggestionsStore.getState().submit('feature', 'short');
    expect(ok).toBe(false);
    expect(useSuggestionsStore.getState().error).toBe('Your suggestion is too short.');
    expect(useSuggestionsStore.getState().suggestions).toEqual([]);
  });

  it('remove replaces the list with the server-returned remainder', async () => {
    invoke.mockResolvedValueOnce({ ok: true, value: { suggestions: [] } });
    useSuggestionsStore.setState({ suggestions: [suggestion] });
    await useSuggestionsStore.getState().remove('s1');
    expect(invoke).toHaveBeenCalledWith('suggestions:remove', { id: 's1' });
    expect(useSuggestionsStore.getState().suggestions).toEqual([]);
  });

  it('clear empties the list from the server response', async () => {
    invoke.mockResolvedValueOnce({ ok: true, value: { suggestions: [] } });
    useSuggestionsStore.setState({ suggestions: [suggestion] });
    await useSuggestionsStore.getState().clear();
    expect(useSuggestionsStore.getState().suggestions).toEqual([]);
  });

  it('exportToFile returns the path on success', async () => {
    invoke.mockResolvedValueOnce({ ok: true, value: { path: '/tmp/out.json' } });
    const path = await useSuggestionsStore.getState().exportToFile();
    expect(path).toBe('/tmp/out.json');
  });

  it('exportToFile returns null when the export call fails, never throws', async () => {
    invoke.mockResolvedValueOnce({
      ok: false,
      error: { code: 'IPC_HANDLER_FAILED', message: 'nope', action: { type: 'none', label: '' } },
    });
    const path = await useSuggestionsStore.getState().exportToFile();
    expect(path).toBeNull();
  });

  it('share returns { status: "opened" } and calls the channel with the id when the mail client opens', async () => {
    invoke.mockResolvedValueOnce({ ok: true, value: { status: 'opened' } });
    const result = await useSuggestionsStore.getState().share('s1');
    expect(result).toEqual({ status: 'opened' });
    expect(invoke).toHaveBeenCalledWith('suggestions:share', { id: 's1' });
  });

  it('share returns status: not_found when the suggestion no longer exists', async () => {
    invoke.mockResolvedValueOnce({ ok: true, value: { status: 'not_found' } });
    const result = await useSuggestionsStore.getState().share('gone');
    expect(result).toEqual({ status: 'not_found' });
  });

  /**
   * BUG-F1-EMAIL-001 / Sprint F1.4 (MailService): this is the case that used to be silent — no
   * mail client available. It now surfaces as its own distinct status, carrying `to`/`subject` so
   * the panel can offer Copy Email / Copy Subject, never collapsed into a generic error.
   */
  it('share returns status: no_mail_client with to/subject when MailService cannot open a mail client', async () => {
    invoke.mockResolvedValueOnce({
      ok: true,
      value: { status: 'no_mail_client', to: 'novaa.support.team@gmail.com', subject: 'Fixora Suggestion - Bug report' },
    });
    const result = await useSuggestionsStore.getState().share('s1');
    expect(result).toEqual({
      status: 'no_mail_client',
      to: 'novaa.support.team@gmail.com',
      subject: 'Fixora Suggestion - Bug report',
    });
  });

  it('share returns status: ipc_error with the real message when the IPC call itself fails unexpectedly', async () => {
    invoke.mockResolvedValueOnce({
      ok: false,
      error: {
        code: 'IPC_HANDLER_FAILED',
        message: 'Something genuinely unexpected happened.',
        action: { type: 'retry', label: 'Try again' },
      },
    });
    const result = await useSuggestionsStore.getState().share('s1');
    expect(result).toEqual({ status: 'ipc_error', message: 'Something genuinely unexpected happened.' });
  });

  it('clearError resets the error to null', () => {
    useSuggestionsStore.setState({ error: 'boom' });
    useSuggestionsStore.getState().clearError();
    expect(useSuggestionsStore.getState().error).toBeNull();
  });
});
