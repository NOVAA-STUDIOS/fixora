import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Repair Reliability (Q2): Repair's provider-failure handling used to discard the `retryable`
 * classification `describeProviderFailure` already computes — Proceed exposed it (P2.2.1), Repair
 * didn't, so the same 429 offered a Retry button in one panel and not the other. These pin that
 * Repair now surfaces `retryable` exactly as the response says, that Retry only appears when it is
 * true, and that the ordinary success/blocked flows are unaffected.
 */

const invoke = vi.hoisted(() => vi.fn());

vi.mock('../lib/bridge.js', () => ({ invoke, subscribe: () => () => undefined }));

const { useAiStore } = await import('./ai-store.js');

const proposal = {
  profile: 'repair' as const,
  historyId: 'h1',
  repairedCode: 'export const B = () => <button className="green" />;',
  originalCode: 'export const B = () => <button />;',
  rationale: 'Made the button green.',
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
  useAiStore.setState({
    status: 'idle',
    activeFindingId: null,
    activeProfile: null,
    streamText: '',
    proposal: null,
    blocked: null,
    errorMessage: null,
    retryable: false,
    failure: null,
  });
});

describe('ai store — run: existing success/blocked flows are unchanged', () => {
  it('OK: a verified proposal reaches `done`, retryable stays false', async () => {
    invoke.mockResolvedValueOnce({ ok: true, value: { status: 'ok', proposal } });
    await useAiStore.getState().run('repair', 'finding-1');
    expect(useAiStore.getState().status).toBe('done');
    expect(useAiStore.getState().proposal).toEqual(proposal);
    expect(useAiStore.getState().retryable).toBe(false);
  });

  it('BLOCKED: a secret-gate refusal is unaffected by the retryable plumbing', async () => {
    invoke.mockResolvedValueOnce({
      ok: true,
      value: {
        status: 'blocked',
        matches: [{ label: 'AWS key', rule: 'aws-key', kind: 'content' }],
      },
    });
    await useAiStore.getState().run('repair', 'finding-1');
    expect(useAiStore.getState().status).toBe('blocked');
    expect(useAiStore.getState().retryable).toBe(false);
  });
});

describe('ai store — run: retryable is exposed correctly', () => {
  it('a retryable provider failure (e.g. quota) sets retryable: true', async () => {
    invoke.mockResolvedValueOnce({
      ok: true,
      value: {
        status: 'error',
        code: 'provider_error',
        message: 'Your OpenRouter quota has been exhausted...',
        retryable: true,
      },
    });
    await useAiStore.getState().run('repair', 'finding-1');
    expect(useAiStore.getState().status).toBe('error');
    expect(useAiStore.getState().retryable).toBe(true);
  });

  it('a non-retryable failure (e.g. no key) sets retryable: false', async () => {
    invoke.mockResolvedValueOnce({
      ok: true,
      value: {
        status: 'error',
        code: 'no_key',
        message: 'Add your provider key in Settings → AI.',
      },
    });
    await useAiStore.getState().run('repair', 'finding-1');
    expect(useAiStore.getState().status).toBe('error');
    expect(useAiStore.getState().retryable).toBe(false);
  });

  it('a transport failure between renderer and main is treated as retryable', async () => {
    invoke.mockResolvedValueOnce({ ok: false, error: { message: 'IPC channel closed' } });
    await useAiStore.getState().run('repair', 'finding-1');
    expect(useAiStore.getState().status).toBe('error');
    expect(useAiStore.getState().retryable).toBe(true);
  });

  it('dismiss() clears retryable along with the rest of the error state', async () => {
    invoke.mockResolvedValueOnce({
      ok: true,
      value: { status: 'error', code: 'provider_error', message: 'quota', retryable: true },
    });
    await useAiStore.getState().run('repair', 'finding-1');
    expect(useAiStore.getState().retryable).toBe(true);
    useAiStore.getState().dismiss();
    expect(useAiStore.getState().retryable).toBe(false);
    expect(useAiStore.getState().status).toBe('idle');
  });
});

describe('ai store — retry', () => {
  it('re-sends the same profile/finding after a retryable failure', async () => {
    invoke.mockResolvedValueOnce({
      ok: true,
      value: { status: 'error', code: 'provider_error', message: 'quota', retryable: true },
    });
    await useAiStore.getState().run('repair', 'finding-1');
    expect(useAiStore.getState().retryable).toBe(true);

    invoke.mockResolvedValueOnce({ ok: true, value: { status: 'ok', proposal } });
    await useAiStore.getState().retry();

    expect(invoke).toHaveBeenLastCalledWith('ai:run', {
      profile: 'repair',
      findingId: 'finding-1',
    });
    expect(useAiStore.getState().status).toBe('done');
  });

  it('does nothing if nothing has ever run (no active profile/finding to retry)', async () => {
    await useAiStore.getState().retry();
    expect(invoke).not.toHaveBeenCalled();
  });
});

describe('ai store — applyRepair: write-verification failure propagates to the UI (Q3 hardening)', () => {
  it('a write-verification failure from main is surfaced, never treated as a successful apply', async () => {
    useAiStore.setState({
      status: 'done',
      proposal,
      activeFindingId: 'finding-1',
      activeProfile: 'repair',
    });
    invoke.mockResolvedValueOnce({
      ok: true,
      value: {
        applied: false,
        reason: 'write-failed',
        message:
          'Fixora wrote src/Button.tsx, but reading it back shows different bytes than what was ' +
          'written. This looks like a data-integrity problem, not a normal failure, so the change ' +
          'was NOT recorded as applied.',
        staleRangeCheck: null,
      },
    });

    const ok = await useAiStore.getState().applyRepair();

    expect(ok).toBe(false);
    expect(useAiStore.getState().errorMessage).toContain('data-integrity problem');
    // The failed apply must not be treated as success anywhere: the proposal is still there (not
    // dismissed), and `fs:readFile` — the "reflect the applied edit" step — was never reached.
    expect(useAiStore.getState().proposal).toEqual(proposal);
    expect(invoke).toHaveBeenCalledTimes(1); // ai:applyRepair only — no fs:readFile follow-up
  });
});

/**
 * Provider Error UX. The classification is computed in the main process and is useless unless it
 * survives the IPC boundary intact — a dropped field degrades the status card to its reduced form
 * silently, which looks like a design choice rather than a bug.
 */
describe('ai store — the classified failure reaches the panel', () => {
  it('carries the failure through verbatim', async () => {
    invoke.mockResolvedValueOnce({
      ok: true,
      value: {
        status: 'error',
        code: 'provider_error',
        message: 'Your provider allowance for this model is used up for now.',
        retryable: false,
        failure: {
          category: 'quota-exceeded',
          layer: 'provider',
          actions: ['change-model', 'check-credits'],
          provider: 'OpenRouter',
          model: 'x/y',
        },
      },
    });
    await useAiStore.getState().run('repair', 'f1');
    const state = useAiStore.getState();
    expect(state.status).toBe('error');
    expect(state.failure?.category).toBe('quota-exceeded');
    expect(state.failure?.layer).toBe('provider');
    expect(state.failure?.actions).toEqual(['change-model', 'check-credits']);
  });

  it('an unclassified failure leaves `failure` null but still sets a message', async () => {
    // The panel must never be empty: the card renders its reduced form from `errorMessage` alone.
    invoke.mockResolvedValueOnce({ ok: false, error: { message: 'The AI service is unavailable.' } });
    await useAiStore.getState().run('repair', 'f1');
    expect(useAiStore.getState().failure).toBeNull();
    expect(useAiStore.getState().errorMessage).toBe('The AI service is unavailable.');
  });

  it('a stale failure never survives into the next run', async () => {
    useAiStore.setState({
      failure: {
        category: 'invalid-api-key',
        layer: 'configuration',
        actions: ['open-settings'],
        provider: 'OpenRouter',
        model: 'x/y',
        attempts: [],
      },
    });
    invoke.mockResolvedValueOnce({ ok: true, value: { status: 'ok', proposal } });
    await useAiStore.getState().run('repair', 'f1');
    expect(useAiStore.getState().failure).toBeNull();
  });
});
