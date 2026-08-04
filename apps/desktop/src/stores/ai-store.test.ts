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

/**
 * Dismiss regression: `run()` awaits an IPC round-trip that can take tens of seconds (provider call
 * + verification). Everything it set after that await used to be written unconditionally, so a
 * Dismiss or Cancel during the request was undone the instant the stale promise resolved — the panel
 * the user had just closed reappeared. Reported as "Dismiss does not close the AI Repair error
 * panel", and reproduced below by resolving the run AFTER the dismiss.
 */
describe('ai store — dismiss closes the panel for good', () => {
  /** A run whose IPC promise we resolve by hand, so we control the in-flight window exactly. */
  function deferredRun(value: unknown): { resolve: () => void; done: Promise<void> } {
    let release: () => void = () => undefined;
    invoke.mockReturnValueOnce(
      new Promise((res) => {
        release = () => {
          res(value);
        };
      }),
    );
    const done = useAiStore.getState().run('repair', 'finding-1');
    return { resolve: release, done };
  }

  it('a run that resolves with an error AFTER dismiss cannot reopen the panel', async () => {
    const quota = {
      ok: true,
      value: {
        status: 'error',
        code: 'provider_error',
        message: 'Your provider allowance for this model is used up for now.',
        retryable: false,
        failure: { category: 'quota-exceeded' },
      },
    };
    const run = deferredRun(quota);
    expect(useAiStore.getState().status).toBe('running');

    useAiStore.getState().dismiss();
    expect(useAiStore.getState().status).toBe('idle');

    run.resolve();
    await run.done;

    // The whole point: the late result is discarded, not written over the dismissal.
    expect(useAiStore.getState().status).toBe('idle');
    expect(useAiStore.getState().errorMessage).toBeNull();
    expect(useAiStore.getState().failure).toBeNull();
  });

  it('a run that resolves with a proposal AFTER dismiss cannot reopen the panel either', async () => {
    const run = deferredRun({ ok: true, value: { status: 'ok', proposal } });
    useAiStore.getState().dismiss();
    run.resolve();
    await run.done;
    expect(useAiStore.getState().status).toBe('idle');
    expect(useAiStore.getState().proposal).toBeNull();
  });

  it('cancel likewise supersedes the in-flight run rather than being overwritten by it', async () => {
    const run = deferredRun({
      ok: true,
      value: { status: 'error', code: 'cancelled', message: 'Cancelled.', retryable: false },
    });
    await useAiStore.getState().cancel();
    expect(useAiStore.getState().status).toBe('idle');
    run.resolve();
    await run.done;
    expect(useAiStore.getState().status).toBe('idle');
    expect(useAiStore.getState().errorMessage).toBeNull();
  });

  it('an undismissed run still writes its result exactly as before', async () => {
    const run = deferredRun({ ok: true, value: { status: 'ok', proposal } });
    run.resolve();
    await run.done;
    expect(useAiStore.getState().status).toBe('done');
    expect(useAiStore.getState().proposal).toEqual(proposal);
  });
});

/**
 * Unhandled-rejection regression. `invoke` is not a Result-only channel: `ipcRenderer.invoke`
 * rejects when main has no handler registered or the handler throws, and the preload throws for an
 * unknown channel. Every caller is fire-and-forget (`void runAi(...)`, `void applyRepair()`), so an
 * unguarded rejection surfaced as "Uncaught (in promise)" in the console AND left the panel stuck
 * on `running` with no way out.
 */
describe('ai store — a rejecting IPC channel never escapes as an unhandled rejection', () => {
  it('run() turns an invoke rejection into the typed error state, not a rejected promise', async () => {
    invoke.mockRejectedValueOnce(new Error("No handler registered for 'ai:run'"));
    await expect(useAiStore.getState().run('repair', 'f1')).resolves.toBeUndefined();
    const s = useAiStore.getState();
    expect(s.status).toBe('error');
    expect(s.errorMessage).toContain('ai:run');
    expect(s.retryable).toBe(true);
    // The spinner must not be left running — that was the user-visible half of this defect.
    expect(s.stage).toBeNull();
  });

  it('run() surfaces a readable message when the rejection carries none', async () => {
    invoke.mockRejectedValueOnce(new Error(''));
    await useAiStore.getState().run('repair', 'f1');
    expect(useAiStore.getState().errorMessage).toMatch(/background process/i);
  });

  it('cancel() swallows nothing but still resolves', async () => {
    invoke.mockRejectedValueOnce(new Error('gone'));
    await expect(useAiStore.getState().cancel()).resolves.toBeUndefined();
    expect(useAiStore.getState().status).toBe('idle');
  });

  it('applyRepair() reports a rejection instead of silently doing nothing', async () => {
    useAiStore.setState({
      status: 'done',
      activeFindingId: 'f1',
      proposal: {
        ...proposal,
        verification: { ...proposal.verification, verdict: 'verified', syntaxOk: true },
      },
    });
    invoke.mockRejectedValueOnce(new Error("No handler registered for 'ai:applyRepair'"));
    await expect(useAiStore.getState().applyRepair()).resolves.toBe(false);
    const s = useAiStore.getState();
    expect(s.errorMessage).toContain('ai:applyRepair');
    // The attempt is still recorded, so the diagnostics panel can explain the dead click.
    expect(s.lastApplyAttempt?.transportError).toContain('ai:applyRepair');
  });

  it('a superseded run that rejects writes nothing at all', async () => {
    let reject: (e: Error) => void = () => undefined;
    invoke.mockReturnValueOnce(new Promise((_res, rej) => { reject = rej; }));
    const running = useAiStore.getState().run('repair', 'f1');
    useAiStore.getState().dismiss();
    reject(new Error('boom'));
    await running;
    expect(useAiStore.getState().status).toBe('idle');
    expect(useAiStore.getState().errorMessage).toBeNull();
  });
});

/**
 * Provider-lifecycle regression. Saving a new key must leave the panel exactly as a fresh launch
 * would — the reported blocker was a valid key still showing "AI Repair Unavailable / Quota
 * exceeded", because every failure field described the PREVIOUS credential and survived the save.
 */
describe('ai store — changing the provider resets state that belonged to the old one', () => {
  const quotaFailure = {
    category: 'quota-exceeded' as const,
    layer: 'provider' as const,
    actions: ['change-model' as const],
    provider: 'OpenRouter',
    model: 'old/model',
    attempts: [],
  };
  const config = {
    configured: true, model: 'new/model', keyHint: '••••new', migratedFrom: null,
    capabilities: null, suggestedModel: null,
  };
  const quotaExceeded = () => {
    useAiStore.setState({
      status: 'error',
      errorMessage: 'Your provider allowance for this model is used up for now.',
      retryable: false,
      failure: quotaFailure,
    });
  };

  it('quota exceeded -> valid key: the quota verdict does not survive Save', async () => {
    quotaExceeded();
    invoke.mockResolvedValueOnce({ ok: true, value: config });
    expect(await useAiStore.getState().setKey('sk-new')).toBeNull();

    const s = useAiStore.getState();
    expect(s.status).toBe('idle');
    expect(s.errorMessage).toBeNull();
    expect(s.failure).toBeNull();
    expect(s.retryable).toBe(false);
    expect(s.config?.keyHint).toBe('••••new');
  });

  it('invalid key -> valid key: the auth failure does not survive Save', async () => {
    useAiStore.setState({
      status: 'error',
      errorMessage: 'The provider did not accept your API key.',
      failure: { ...quotaFailure, category: 'invalid-api-key', layer: 'configuration' },
    });
    invoke.mockResolvedValueOnce({ ok: true, value: config });
    await useAiStore.getState().setKey('sk-good');
    expect(useAiStore.getState().failure).toBeNull();
    expect(useAiStore.getState().errorMessage).toBeNull();
  });

  it('model A -> model B: the previous model’s quota does not carry over', async () => {
    quotaExceeded();
    invoke.mockResolvedValueOnce({ ok: true, value: { ...config, model: 'other/model' } });
    await useAiStore.getState().setModel('other/model');
    expect(useAiStore.getState().status).toBe('idle');
    expect(useAiStore.getState().failure).toBeNull();
    expect(useAiStore.getState().config?.model).toBe('other/model');
  });

  it('clearing the key also clears the old failure', async () => {
    quotaExceeded();
    invoke.mockResolvedValueOnce({ ok: true, value: { ...config, configured: false } });
    await useAiStore.getState().clearKey();
    expect(useAiStore.getState().errorMessage).toBeNull();
    expect(useAiStore.getState().failure).toBeNull();
  });

  it('a stale proposal from the old key is discarded, not left applyable', async () => {
    useAiStore.setState({ status: 'done', proposal, lastApplyAttempt: { at: 1 } as never });
    invoke.mockResolvedValueOnce({ ok: true, value: config });
    await useAiStore.getState().setKey('sk-new');
    expect(useAiStore.getState().proposal).toBeNull();
    expect(useAiStore.getState().lastApplyAttempt).toBeNull();
  });

  /** The race the reset must also win: a run issued on the OLD key resolving after the switch. */
  it('an in-flight run from the old key cannot re-assert its failure after Save', async () => {
    let release: () => void = () => undefined;
    invoke.mockReturnValueOnce(
      new Promise((res) => {
        release = () => {
          res({
            ok: true,
            value: {
              status: 'error', code: 'provider_error',
              message: 'Your provider allowance for this model is used up for now.',
              retryable: false, failure: quotaFailure,
            },
          });
        };
      }),
    );
    const running = useAiStore.getState().run('repair', 'f1');

    invoke.mockResolvedValueOnce({ ok: true, value: config });
    await useAiStore.getState().setKey('sk-new');

    release();
    await running;

    expect(useAiStore.getState().status).toBe('idle');
    expect(useAiStore.getState().errorMessage).toBeNull();
    expect(useAiStore.getState().failure).toBeNull();
  });

  it('rapid key switching leaves the state of the LAST save, with no failure carried', async () => {
    quotaExceeded();
    for (const hint of ['••••a', '••••b', '••••c']) {
      invoke.mockResolvedValueOnce({ ok: true, value: { ...config, keyHint: hint } });
      await useAiStore.getState().setKey('sk-' + hint);
    }
    const s = useAiStore.getState();
    expect(s.config?.keyHint).toBe('••••c');
    expect(s.status).toBe('idle');
    expect(s.failure).toBeNull();
  });

  it('a FAILED save leaves the existing state alone — nothing is reset on an error', async () => {
    quotaExceeded();
    invoke.mockResolvedValueOnce({ ok: false, error: { code: 'keychain_unavailable', message: 'no keychain' } });
    expect(await useAiStore.getState().setKey('sk-bad')).toBe('no keychain');
    // The old failure is still the truth: nothing changed, so nothing should have been cleared.
    expect(useAiStore.getState().status).toBe('error');
    expect(useAiStore.getState().failure).not.toBeNull();
  });
});

/**
 * Automatic resume after a quota refusal. Quota is the one failure a new credential plainly
 * resolves — the work was valid, the allowance was not — so the request the old key refused is
 * replayed rather than left for the user to find and re-issue by hand.
 */
describe('ai store — resumes the refused request after the provider changes', () => {
  const quota = {
    category: 'quota-exceeded' as const, layer: 'provider' as const,
    actions: ['change-model' as const], provider: 'OpenRouter', model: 'old', attempts: [],
  };
  const config = {
    configured: true, model: 'new/model', keyHint: '••••new', migratedFrom: null,
    capabilities: null, suggestedModel: null,
  };
  const refusedFor = (failure: unknown) => {
    useAiStore.setState({
      status: 'error',
      errorMessage: 'refused',
      failure: failure as never,
      activeProfile: 'repair',
      activeFindingId: 'finding-42',
      activeMode: 'finding',
    });
  };

  it('replays the SAME profile, finding and mode after a quota failure', async () => {
    refusedFor(quota);
    invoke.mockResolvedValueOnce({ ok: true, value: config });                 // ai:setKey
    invoke.mockResolvedValueOnce({ ok: true, value: { status: 'ok', proposal } }); // replayed ai:run
    await useAiStore.getState().setKey('sk-new');
    await vi.waitFor(() => {
      expect(useAiStore.getState().status).toBe('done');
    });
    expect(invoke).toHaveBeenCalledWith('ai:run', {
      profile: 'repair',
      findingId: 'finding-42',
      mode: 'finding',
    });
  });

  it('resumes after a model switch too — a new model has its own allowance', async () => {
    refusedFor(quota);
    invoke.mockResolvedValueOnce({ ok: true, value: config });
    invoke.mockResolvedValueOnce({ ok: true, value: { status: 'ok', proposal } });
    await useAiStore.getState().setModel('new/model');
    await vi.waitFor(() => {
      expect(useAiStore.getState().status).toBe('done');
    });
  });

  it('does NOT resume for an auth failure — the new key may be invalid too', async () => {
    refusedFor({ ...quota, category: 'invalid-api-key', layer: 'configuration' });
    invoke.mockResolvedValueOnce({ ok: true, value: config });
    await useAiStore.getState().setKey('sk-new');
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(useAiStore.getState().status).toBe('idle');
  });

  it('does NOT resume when nothing was pending', async () => {
    useAiStore.setState({ status: 'idle', failure: null, activeFindingId: null, activeProfile: null });
    invoke.mockResolvedValueOnce({ ok: true, value: config });
    await useAiStore.getState().setKey('sk-new');
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('does NOT resume on a failed save — nothing changed, so nothing is retried', async () => {
    refusedFor(quota);
    invoke.mockResolvedValueOnce({ ok: false, error: { code: 'x', message: 'no keychain' } });
    await useAiStore.getState().setKey('sk-bad');
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(useAiStore.getState().status).toBe('error');
  });
});

/**
 * Force Apply must actually reach the write.
 *
 * The feature shipped inert: the dialog resolved, the button fired, and `applyRepair` was entered
 * with `forced: true` — and then the gate guard at the top returned false before `invoke` was ever
 * called. No IPC, no file write, no editor refresh. The `forced` flag was plumbed into the request
 * payload but the guard above it never consulted it, so the whole feature was a no-op that looked
 * like a working button.
 *
 * These pin the exemption AND its boundary: forced passes the verification gate only, an ordinary
 * apply is still refused by it, and every downstream protection still runs.
 */
describe('ai store — Force Apply reaches the write', () => {
  const rejected = {
    ...proposal,
    verification: {
      verdict: 'regression' as const,
      targetResolved: true,
      newFindingCount: 1,
      syntaxOk: false,
      ran: ['syntax'],
    },
  };

  it('an ordinary apply on a FAILED gate is still refused before any IPC', async () => {
    useAiStore.setState({ status: 'done', proposal: rejected, activeFindingId: 'f1' });
    const ok = await useAiStore.getState().applyRepair();
    expect(ok).toBe(false);
    // The guard is intact: nothing was sent.
    expect(invoke).not.toHaveBeenCalled();
  });

  it('a FORCED apply reaches ai:applyRepair, carrying the audit flag', async () => {
    useAiStore.setState({ status: 'done', proposal: rejected, activeFindingId: 'f1' });
    invoke.mockResolvedValueOnce({
      ok: true,
      value: { applied: true, reason: null, message: 'applied', staleRangeCheck: null },
    });
    invoke.mockResolvedValueOnce({ ok: true, value: { file: { content: 'new content' } } });
    // The history refresh that follows every successful apply (fire-and-forget in the store).
    invoke.mockResolvedValueOnce({ ok: true, value: { entries: [] } });

    const ok = await useAiStore.getState().applyRepair({ forced: true });

    expect(ok).toBe(true);
    expect(invoke).toHaveBeenCalledWith(
      'ai:applyRepair',
      expect.objectContaining({
        file: 'src/Button.tsx',
        code: rejected.repairedCode,
        // The staleness guard's input is still sent — forcing does not skip it.
        expectedOriginal: rejected.originalCode,
        forced: true,
      }),
    );
  });

  it('refreshes the editor buffer after a forced write, like any other apply', async () => {
    useAiStore.setState({ status: 'done', proposal: rejected, activeFindingId: 'f1' });
    invoke.mockResolvedValueOnce({
      ok: true,
      value: { applied: true, reason: null, message: 'applied', staleRangeCheck: null },
    });
    invoke.mockResolvedValueOnce({ ok: true, value: { file: { content: 'new content' } } });
    // The history refresh that follows every successful apply (fire-and-forget in the store).
    invoke.mockResolvedValueOnce({ ok: true, value: { entries: [] } });

    await useAiStore.getState().applyRepair({ forced: true });

    // The re-read that reflects the change in the open buffer.
    expect(invoke).toHaveBeenCalledWith('fs:readFile', { relPath: 'src/Button.tsx' });
    // And the proposal is cleared, as after any successful apply.
    expect(useAiStore.getState().proposal).toBeNull();
  });

  it('still honours main REFUSING a forced write — the override is not of file safety', async () => {
    useAiStore.setState({ status: 'done', proposal: rejected, activeFindingId: 'f1' });
    invoke.mockResolvedValueOnce({
      ok: true,
      value: {
        applied: false,
        reason: 'stale-range',
        message: 'The file changed since this repair was generated.',
        staleRangeCheck: null,
      },
    });

    const ok = await useAiStore.getState().applyRepair({ forced: true });

    expect(ok).toBe(false);
    expect(useAiStore.getState().errorMessage).toMatch(/changed since/i);
    // No refresh, and the proposal survives so the user can see what failed.
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(useAiStore.getState().proposal).toEqual(rejected);
  });

  it('does not need forcing when the gate already passes', async () => {
    useAiStore.setState({ status: 'done', proposal, activeFindingId: 'f1' });
    invoke.mockResolvedValueOnce({
      ok: true,
      value: { applied: true, reason: null, message: 'applied', staleRangeCheck: null },
    });
    invoke.mockResolvedValueOnce({ ok: true, value: { file: { content: 'new' } } });
    invoke.mockResolvedValueOnce({ ok: true, value: { entries: [] } });

    await useAiStore.getState().applyRepair();

    // Accept's request is unchanged — no `forced` key at all.
    const sent = invoke.mock.calls.find((c) => c[0] === 'ai:applyRepair')?.[1] as Record<string, unknown>;
    expect(sent).not.toHaveProperty('forced');
  });
});
