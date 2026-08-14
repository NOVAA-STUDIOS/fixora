import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CatalogueModel } from './catalogue.js';
import {
  buildFailoverChain,
  failoverScope,
  runWithFailover,
  shouldFailover,
  type FailoverAttemptResult,
  type FailoverCandidate,
} from './failover.js';
import { describeModelOutputFailure, describeProviderFailure } from './failure.js';

/**
 * Provider failover.
 *
 * The scenarios below are written as behaviours a user would recognise ("the first provider is down,
 * the second works, and I never had to touch a setting") rather than as unit assertions on the loop,
 * because the loop is not the point — not stranding the user is.
 */

const CHAIN: [FailoverCandidate, ...FailoverCandidate[]] = [
  { provider: 'openrouter', model: 'model-a' },
  { provider: 'openrouter', model: 'model-b' },
  { provider: 'openrouter', model: 'model-c' },
];

/** A failure of the given HTTP shape, classified exactly as the live pipeline would classify it. */
const fail = (code: string, detail = ''): FailoverAttemptResult<string> => ({
  ok: false,
  failure: describeProviderFailure({ providerCode: code, detail }),
});
const ok = (value: string): FailoverAttemptResult<string> => ({ ok: true, value });

/** 503 — provider unavailable, the canonical failover trigger. */
const DOWN = (): FailoverAttemptResult<string> => fail('HTTP_503');
/** 401 — a rejected key, which every candidate on this adapter would reject identically. */
const BAD_KEY = (): FailoverAttemptResult<string> => fail('HTTP_401');

describe('failover — the five required scenarios', () => {
  it('first provider fails, second succeeds', async () => {
    const attempt = vi
      .fn<(c: FailoverCandidate) => Promise<FailoverAttemptResult<string>>>()
      .mockResolvedValueOnce(DOWN())
      .mockResolvedValueOnce(ok('repaired'));

    const outcome = await runWithFailover(CHAIN, attempt);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value).toBe('repaired');
    expect(outcome.candidate.model).toBe('model-b');
    // The walk is recorded, so a support log can show what was tried and why it moved on.
    expect(outcome.attempts).toHaveLength(1);
    expect(outcome.attempts[0]?.candidate.model).toBe('model-a');
    expect(outcome.attempts[0]?.failure.category).toBe('provider-unavailable');
  });

  it('second fails, third succeeds', async () => {
    const attempt = vi
      .fn<(c: FailoverCandidate) => Promise<FailoverAttemptResult<string>>>()
      .mockResolvedValueOnce(DOWN())
      .mockResolvedValueOnce(fail('HTTP_429', 'Rate limit exceeded'))
      .mockResolvedValueOnce(ok('repaired'));

    const outcome = await runWithFailover(CHAIN, attempt);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.candidate.model).toBe('model-c');
    expect(outcome.attempts.map((a) => a.failure.category)).toEqual([
      'provider-unavailable',
      'rate-limited',
    ]);
  });

  it('all providers fail — reports the LAST failure, having tried every one', async () => {
    const attempt = vi
      .fn<(c: FailoverCandidate) => Promise<FailoverAttemptResult<string>>>()
      .mockResolvedValueOnce(DOWN())
      .mockResolvedValueOnce(DOWN())
      .mockResolvedValueOnce(fail('HTTP_404'));

    const outcome = await runWithFailover(CHAIN, attempt);

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toBe('exhausted');
    expect(attempt).toHaveBeenCalledTimes(3);
    // The last failure, not the first: it is the current state of the world and what the user's next
    // action has to address.
    expect(outcome.failure.category).toBe('model-unavailable');
    expect(outcome.candidate.model).toBe('model-c');
    // Every failure is recorded, including the last — a support log needs the one that ended it.
    expect(outcome.attempts).toHaveLength(3);
  });

  it('an invalid key is never re-offered to the SAME provider’s other models', async () => {
    const attempt = vi
      .fn<(c: FailoverCandidate) => Promise<FailoverAttemptResult<string>>>()
      .mockResolvedValue(BAD_KEY());

    const outcome = await runWithFailover(CHAIN, attempt);

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toBe('non-retryable');
    // ONE call, not three. Every candidate here is a model on the same provider, so they all present
    // the identical rejected key — walking them would turn one clear "fix your key" into three
    // confusing failures. A candidate on a DIFFERENT provider is another matter entirely; see the
    // cross-provider block below.
    expect(attempt).toHaveBeenCalledTimes(1);
    expect(outcome.failure.category).toBe('invalid-api-key');
    expect(outcome.failure.layer).toBe('configuration');
    expect(outcome.attempts).toHaveLength(1);
    // Configuration guidance survives to the caller, which is what the card renders.
    expect(outcome.failure.actions).toContain('open-settings');
  });

  it('a successful provider immediately stops failover — nothing further is contacted', async () => {
    const attempt = vi
      .fn<(c: FailoverCandidate) => Promise<FailoverAttemptResult<string>>>()
      .mockResolvedValue(ok('repaired'));

    const outcome = await runWithFailover(CHAIN, attempt);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(attempt).toHaveBeenCalledTimes(1);
    expect(outcome.candidate.model).toBe('model-a');
    expect(outcome.attempts).toEqual([]);
  });
});

describe('which failures are worth trying elsewhere', () => {
  it('fails over for every category the requirements name', () => {
    for (const code of ['HTTP_429', 'HTTP_408', 'HTTP_504', 'TIMEOUT', 'HTTP_500', 'HTTP_503', 'HTTP_404']) {
      expect(shouldFailover(describeProviderFailure({ providerCode: code })), code).toBe(true);
    }
  });

  it('scopes authentication and permission failures to a different credential', () => {
    // Worth carrying — but only to a candidate that presents a different key. `runWithFailover` is
    // what enforces the second half; this is the policy that tells it to.
    for (const code of ['HTTP_401', 'HTTP_403']) {
      expect(failoverScope(describeProviderFailure({ providerCode: code })), code).toBe(
        'different-credential',
      );
    }
  });

  /**
   * Retryable and failover-eligible are different questions. `network-offline` is retryable — the
   * same request may well work in a minute — and is the clearest case where walking the chain is
   * just five more ways to fail slowly, because no candidate is reachable.
   */
  it('does not confuse "retryable" with "worth trying elsewhere"', () => {
    const offline = describeProviderFailure({ providerCode: 'NETWORK' });
    expect(offline.retryable).toBe(true);
    expect(shouldFailover(offline)).toBe(false);
  });

  it('stops for failures every candidate would reproduce', () => {
    for (const code of ['NETWORK', 'HTTP_413']) {
      expect(shouldFailover(describeProviderFailure({ providerCode: code })), code).toBe(false);
    }
  });

  /**
   * Quota arrives in two shapes with opposite answers, and the layer is what separates them.
   *
   * A per-model allowance (429 naming a daily or free-tier limit) is the case automatic failover
   * exists for: the next model has its own allowance. An account out of credits (402) follows the
   * ACCOUNT, so every candidate draws on the same empty balance and a walk would bury the one thing
   * that helps under N identical failures.
   */
  it('fails over for per-model quota exhaustion', () => {
    const perModel = describeProviderFailure({
      providerCode: 'HTTP_429',
      detail: 'Rate limit exceeded: free-models-per-day. Add 10 credits to unlock 1000 requests',
    });
    expect(perModel.category).toBe('quota-exceeded');
    expect(perModel.layer).toBe('provider');
    expect(shouldFailover(perModel)).toBe(true);
  });

  it('does NOT fail over when the account itself is out of credits', () => {
    const outOfCredits = describeProviderFailure({ providerCode: 'HTTP_402' });
    expect(outOfCredits.category).toBe('quota-exceeded');
    expect(outOfCredits.layer).toBe('configuration');
    expect(shouldFailover(outOfCredits)).toBe(false);
  });
});

describe('failover — cancellation and reporting', () => {
  it('stops walking when the caller aborts', async () => {
    const controller = new AbortController();
    const attempt = vi
      .fn<(c: FailoverCandidate) => Promise<FailoverAttemptResult<string>>>()
      .mockImplementation(() => {
        controller.abort();
        return Promise.resolve(DOWN());
      });

    const outcome = await runWithFailover(CHAIN, attempt, { signal: controller.signal });

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toBe('cancelled');
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it('announces each failover so the UI can say it is moving on', async () => {
    const onFailover = vi.fn();
    const attempt = vi
      .fn<(c: FailoverCandidate) => Promise<FailoverAttemptResult<string>>>()
      .mockResolvedValueOnce(DOWN())
      .mockResolvedValueOnce(ok('repaired'));

    await runWithFailover(CHAIN, attempt, { onFailover });

    expect(onFailover).toHaveBeenCalledOnce();
    expect(onFailover).toHaveBeenCalledWith(
      expect.objectContaining({ candidate: { provider: 'openrouter', model: 'model-a' } }),
    );
  });

  it('a single-candidate chain still reports a clean exhausted outcome', async () => {
    const only: [FailoverCandidate] = [{ provider: 'openrouter', model: 'solo' }];
    const outcome = await runWithFailover(only, () => Promise.resolve(DOWN()));
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toBe('exhausted');
    expect(outcome.attempts).toHaveLength(1);
  });
});

describe('same-candidate retry (opt-in via retryBackoffMs)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** Runs `promise` while draining fake timers, so a real await never blocks on a real delay. */
  async function settled<T>(promise: Promise<T>): Promise<T> {
    const result = promise;
    await vi.runAllTimersAsync();
    return result;
  }

  it('without retryBackoffMs, behaviour is byte-for-byte the same as before — one attempt, then failover', async () => {
    const attempt = vi
      .fn<(c: FailoverCandidate) => Promise<FailoverAttemptResult<string>>>()
      .mockResolvedValueOnce(DOWN())
      .mockResolvedValueOnce(ok('repaired'));

    const outcome = await settled(runWithFailover(CHAIN, attempt));

    expect(outcome.ok).toBe(true);
    expect(attempt).toHaveBeenCalledTimes(2);
    if (!outcome.ok) return;
    expect(outcome.candidate.model).toBe('model-b');
  });

  it('retries the SAME candidate on a retryable failure before trying a different one', async () => {
    const attempt = vi
      .fn<(c: FailoverCandidate) => Promise<FailoverAttemptResult<string>>>()
      .mockResolvedValueOnce(DOWN()) // model-a, attempt 1 — retryable
      .mockResolvedValueOnce(ok('repaired')); // model-a, retry 1 — succeeds

    const outcome = await settled(
      runWithFailover(CHAIN, attempt, { retryBackoffMs: [1000, 2000] }),
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    // Never moved on: the SAME candidate answered on retry.
    expect(outcome.candidate.model).toBe('model-a');
    expect(outcome.attempts).toHaveLength(0);
    expect(attempt).toHaveBeenCalledTimes(2);
    expect(attempt.mock.calls[0]?.[0]).toEqual({ provider: 'openrouter', model: 'model-a' });
    expect(attempt.mock.calls[1]?.[0]).toEqual({ provider: 'openrouter', model: 'model-a' });
  });

  it('gives up after exhausting the backoff schedule and THEN fails over', async () => {
    const attempt = vi
      .fn<(c: FailoverCandidate) => Promise<FailoverAttemptResult<string>>>()
      .mockResolvedValueOnce(DOWN()) // model-a, attempt 1
      .mockResolvedValueOnce(DOWN()) // model-a, retry 1
      .mockResolvedValueOnce(DOWN()) // model-a, retry 2 — schedule exhausted
      .mockResolvedValueOnce(ok('repaired')); // model-b

    const outcome = await settled(
      runWithFailover(CHAIN, attempt, { retryBackoffMs: [1000, 2000] }),
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.candidate.model).toBe('model-b');
    expect(attempt).toHaveBeenCalledTimes(4);
    expect(outcome.attempts).toHaveLength(1);
    expect(outcome.attempts[0]?.candidate.model).toBe('model-a');
  });

  it('does NOT retry a non-retryable failure (exhausted quota) — fails over immediately', async () => {
    const attempt = vi
      .fn<(c: FailoverCandidate) => Promise<FailoverAttemptResult<string>>>()
      .mockResolvedValueOnce(fail('HTTP_429', 'free-models-per-day exhausted'))
      .mockResolvedValueOnce(ok('repaired'));

    const outcome = await settled(
      runWithFailover(CHAIN, attempt, { retryBackoffMs: [1000, 2000] }),
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.candidate.model).toBe('model-b');
    expect(attempt).toHaveBeenCalledTimes(2);
  });

  it('calls onRetry with the attempt number and delay before each retry', async () => {
    const onRetry = vi.fn();
    const attempt = vi
      .fn<(c: FailoverCandidate) => Promise<FailoverAttemptResult<string>>>()
      .mockResolvedValueOnce(DOWN())
      .mockResolvedValueOnce(ok('repaired'));

    await settled(runWithFailover(CHAIN, attempt, { retryBackoffMs: [1000, 2000], onRetry }));

    expect(onRetry).toHaveBeenCalledOnce();
    expect(onRetry).toHaveBeenCalledWith(
      expect.objectContaining({
        candidate: { provider: 'openrouter', model: 'model-a' },
        attempt: 1,
        delayMs: 1000,
      }),
    );
  });
});

describe('buildFailoverChain', () => {
  const model = (id: string, structuredOutput: boolean): CatalogueModel => ({
    id,
    name: id,
    free: true,
    codeCapable: true,
    structuredOutput,
    contextLength: 8192,
  });

  const catalogue = [model('fallback-1', true), model('fallback-2', true), model('no-schema', false)];

  it('puts the user’s configured model first, always', () => {
    const chain = buildFailoverChain({
      provider: 'openrouter',
      configured: 'my-choice',
      preferred: ['fallback-1'],
      catalogue,
      profile: 'repair',
    });
    expect(chain[0]).toEqual({ provider: 'openrouter', model: 'my-choice' });
  });

  /**
   * The configured model is never capability-filtered, even when the catalogue does not vouch for it.
   * It is the user's explicit choice; demoting it silently would be the tool overruling a decision it
   * is not entitled to overrule. Fallbacks are OUR suggestions, so they are held to a higher bar.
   */
  it('never drops the configured model, even when the catalogue does not know it', () => {
    const chain = buildFailoverChain({
      provider: 'openrouter',
      configured: 'totally-unknown',
      preferred: [],
      catalogue,
      profile: 'repair',
    });
    expect(chain).toHaveLength(1);
    expect(chain[0].model).toBe('totally-unknown');
  });

  it('drops fallbacks that cannot do what the profile needs', () => {
    const chain = buildFailoverChain({
      provider: 'openrouter',
      configured: 'my-choice',
      preferred: ['no-schema', 'fallback-1'],
      catalogue,
      profile: 'repair', // needs structured output
    });
    expect(chain.map((c) => c.model)).toEqual(['my-choice', 'fallback-1']);
  });

  it('keeps a non-schema fallback for a profile that does not need one', () => {
    const chain = buildFailoverChain({
      provider: 'openrouter',
      configured: 'my-choice',
      preferred: ['no-schema'],
      catalogue,
      profile: 'explain',
    });
    expect(chain.map((c) => c.model)).toEqual(['my-choice', 'no-schema']);
  });

  it('drops fallbacks absent from the catalogue rather than spending a request to find out', () => {
    const chain = buildFailoverChain({
      provider: 'openrouter',
      configured: 'my-choice',
      preferred: ['retired-model'],
      catalogue,
      profile: 'repair',
    });
    expect(chain).toHaveLength(1);
  });

  it('bounds the walk — failover trades latency for success, so the trade is capped', () => {
    const chain = buildFailoverChain({
      provider: 'openrouter',
      configured: 'my-choice',
      preferred: ['fallback-1', 'fallback-2'],
      catalogue,
      profile: 'repair',
      limit: 2,
    });
    expect(chain).toHaveLength(2);
  });

  it('never repeats the configured model as its own fallback', () => {
    const chain = buildFailoverChain({
      provider: 'openrouter',
      configured: 'fallback-1',
      preferred: ['fallback-1', 'fallback-2'],
      catalogue,
      profile: 'repair',
    });
    expect(chain.map((c) => c.model)).toEqual(['fallback-1', 'fallback-2']);
  });
});

/**
 * The safety boundary, stated as a test rather than as a comment.
 *
 * Failover recovers from a provider that would not ANSWER. It must never re-run a repair that was
 * answered and then rejected by the parser, the verifier, the regression check or the Apply gate:
 * shopping a rejection around until some model gets past it is precisely how a safety gate stops
 * being a safety gate.
 *
 * Structurally this holds because those rejections happen downstream of a SUCCESSFUL attempt, and a
 * success ends the walk. The tests below pin that structure from both directions.
 */
describe('failover never re-runs a repair-safety rejection', () => {
  it('a provider that answers ends the walk, whatever happens to the answer afterwards', async () => {
    // The attempt resolves ok. The repair may later fail to parse, fail verification, or be refused
    // by the Apply gate, and none of that is visible here BY DESIGN.
    const attempt = vi
      .fn<(c: FailoverCandidate) => Promise<FailoverAttemptResult<string>>>()
      .mockResolvedValue(ok('a patch that will later be rejected'));

    const outcome = await runWithFailover(CHAIN, attempt);

    expect(outcome.ok).toBe(true);
    // One call. Nothing downstream can cause a second candidate to be tried.
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it('only provider-availability failures can trigger a walk, nothing else', () => {
    const availability = new Set([
      'rate-limited',
      'timeout',
      'provider-unavailable',
      'model-unavailable',
      'quota-exceeded',
    ]);
    for (const code of [
      'HTTP_401',
      'HTTP_402',
      'HTTP_403',
      'HTTP_413',
      'HTTP_400',
      'NETWORK',
      'NO_BODY',
      'STREAM',
      'WEIRD',
    ]) {
      const failure = describeProviderFailure({ providerCode: code });
      // Credential rejections are the one exception, and a narrow one: they reach only candidates
      // presenting a different key, never the wider chain. Asserted as a scope so this stays a
      // statement about what may be walked rather than a hole in the rule.
      const credential = failure.category === 'invalid-api-key' || failure.category === 'auth-failed';
      if (credential) {
        expect(failoverScope(failure), code).toBe('different-credential');
      } else if (!availability.has(failure.category) || failure.layer === 'configuration') {
        expect(shouldFailover(failure), code + ' -> ' + failure.category).toBe(false);
      }
    }
    // Unusable model output is an ANSWER, not an availability failure. It must not walk.
    expect(shouldFailover(describeModelOutputFailure('empty'))).toBe(false);
    expect(shouldFailover(describeModelOutputFailure('schema-mismatch', 'x'))).toBe(false);
  });
});

describe('mixed failures across a chain', () => {
  it('walks past availability failures and stops dead on a configuration one', async () => {
    const attempt = vi
      .fn<(c: FailoverCandidate) => Promise<FailoverAttemptResult<string>>>()
      // Quota on the first model. The new behaviour: keep going.
      .mockResolvedValueOnce(fail('HTTP_429', 'free-models-per-day exhausted'))
      // A transient outage on the second. Keep going.
      .mockResolvedValueOnce(fail('HTTP_503'))
      // The account is out of credits. No candidate can escape that, so stop here.
      .mockResolvedValueOnce(fail('HTTP_402'));

    const outcome = await runWithFailover(CHAIN, attempt);

    expect(attempt).toHaveBeenCalledTimes(3);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toBe('non-retryable');
    expect(outcome.failure.category).toBe('quota-exceeded');
    expect(outcome.failure.layer).toBe('configuration');
    // The whole walk is available for one consolidated card.
    expect(outcome.attempts.map((a) => a.failure.category)).toEqual([
      'quota-exceeded',
      'provider-unavailable',
      'quota-exceeded',
    ]);
  });

  it('quota on the first model, success on the second, and the user never sees an error', async () => {
    const attempt = vi
      .fn<(c: FailoverCandidate) => Promise<FailoverAttemptResult<string>>>()
      .mockResolvedValueOnce(fail('HTTP_429', 'free-models-per-day exhausted'))
      .mockResolvedValueOnce(ok('repaired'));

    const outcome = await runWithFailover(CHAIN, attempt);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value).toBe('repaired');
    expect(outcome.candidate.model).toBe('model-b');
  });

  it('every model exhausted, one outcome carrying the complete list of what was tried', async () => {
    const attempt = vi
      .fn<(c: FailoverCandidate) => Promise<FailoverAttemptResult<string>>>()
      .mockResolvedValue(fail('HTTP_429', 'free-models-per-day exhausted'));

    const outcome = await runWithFailover(CHAIN, attempt);

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toBe('exhausted');
    expect(outcome.attempts.map((a) => a.candidate.model)).toEqual([
      'model-a',
      'model-b',
      'model-c',
    ]);
  });
});

/**
 * The failover contract, stated as the product requires it.
 *
 * Two halves, and the negative half is the one that matters: an availability problem should move to
 * the next provider, and a CONFIGURATION problem must not — failing a bad key over to five providers
 * turns one clear "fix your key" into five confusing failures and spends five requests proving it.
 */
describe('failover policy — availability moves on, configuration does not', () => {
  const cloud = { provider: 'openrouter', model: 'm', local: false };

  it('fails over for provider AVAILABILITY failures', () => {
    for (const category of ['rate-limited', 'timeout', 'provider-unavailable', 'model-unavailable'] as const) {
      expect(shouldFailover({ category, layer: 'provider' }, cloud), category).toBe(true);
    }
  });

  it('fails over for a per-model quota exhaustion — another model has its own allowance', () => {
    expect(shouldFailover({ category: 'quota-exceeded', layer: 'provider' }, cloud)).toBe(true);
  });

  it('carries a rejected credential to a DIFFERENT one, and nowhere else', () => {
    // Not "stop", and not "try anything". Every provider now holds its own key, so provider A
    // refusing its key is no evidence at all about provider B's — but A's other models present the
    // very same key and would be told the very same thing.
    for (const category of ['invalid-api-key', 'auth-failed'] as const) {
      expect(failoverScope({ category, layer: 'configuration' }, cloud), category).toBe(
        'different-credential',
      );
    }
  });

  it('does NOT fail over for an account out of credits', () => {
    // Every candidate draws on the same balance; a walk buries the one fix under N identical errors.
    expect(shouldFailover({ category: 'quota-exceeded', layer: 'configuration' }, cloud)).toBe(false);
  });

  it('does NOT fail over for a prompt or response problem', () => {
    // The model answered, or the request was malformed. Neither is another provider's to rescue.
    expect(shouldFailover({ category: 'context-too-large', layer: 'configuration' }, cloud)).toBe(false);
    expect(shouldFailover({ category: 'invalid-response', layer: 'provider' }, cloud)).toBe(false);
  });
});

describe('failover policy — an unreachable LOCAL daemon is not an offline internet', () => {
  const cloud = { provider: 'openrouter', model: 'm', local: false };
  const local = { provider: 'ollama', model: 'm', local: true };

  it('fails over when a LOCAL endpoint refuses the connection', () => {
    // Ollama is not running. That says nothing about whether OpenRouter is reachable, and without
    // this the whole chain stops at a process that was never started.
    expect(shouldFailover({ category: 'network-offline', layer: 'provider' }, local)).toBe(true);
  });

  it('does NOT fail over when a CLOUD endpoint is unreachable', () => {
    // The machine is offline. Trying five more cloud candidates is five more ways to fail slowly.
    expect(shouldFailover({ category: 'network-offline', layer: 'provider' }, cloud)).toBe(false);
  });

  it('treats an unknown candidate as cloud — the safe default', () => {
    expect(shouldFailover({ category: 'network-offline', layer: 'provider' })).toBe(false);
  });
});

/**
 * CREDENTIAL-SCOPED FAILOVER.
 *
 * The rule that a rejected key ends the walk was written when a chain meant several models on ONE
 * key, where it was exactly right. Once every provider carried its own credential it became a trap:
 * a stale key on the provider at priority 1 made every correctly-configured provider behind it
 * unreachable, and the only remedy was to notice and reorder the chain by hand.
 *
 * What survives is the half that was always true — the same key is not worth presenting twice.
 */
describe('a rejected key skips its own provider, not the whole chain', () => {
  const MIXED: [FailoverCandidate, ...FailoverCandidate[]] = [
    { provider: 'openrouter', model: 'or-a' },
    { provider: 'openrouter', model: 'or-b' },
    { provider: 'gemini', model: 'gemini-2.5-flash' },
  ];

  it('walks past a bad key to the next PROVIDER, skipping its sibling models', async () => {
    const asked: string[] = [];
    const attempt = vi.fn((candidate: FailoverCandidate) => {
      asked.push(`${candidate.provider}:${candidate.model}`);
      return Promise.resolve(
        candidate.provider === 'openrouter' ? BAD_KEY() : { ok: true as const, value: 'patch' },
      );
    });

    const outcome = await runWithFailover(MIXED, attempt);

    // `or-b` is never contacted: it would present the same rejected key. `gemini` is.
    expect(asked).toEqual(['openrouter:or-a', 'gemini:gemini-2.5-flash']);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value).toBe('patch');
    expect(outcome.candidate.provider).toBe('gemini');
    // The rejection is still on the record even though the walk recovered from it.
    expect(outcome.attempts.map((a) => a.failure.category)).toEqual(['invalid-api-key']);
  });

  it('reports non-retryable when EVERY credential is refused', async () => {
    const attempt = vi.fn(() => Promise.resolve(BAD_KEY()));
    const outcome = await runWithFailover(MIXED, attempt);

    // One call per credential — two providers, two attempts, not three.
    expect(attempt).toHaveBeenCalledTimes(2);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    // Not `exhausted`: nothing here is worth retrying, and the two send a user to different places.
    expect(outcome.reason).toBe('non-retryable');
    expect(outcome.failure.actions).toContain('open-settings');
    expect(outcome.attempts).toHaveLength(2);
  });

  it('does not let a bad key mask a later provider’s DIFFERENT failure', async () => {
    const attempt = vi
      .fn<(c: FailoverCandidate) => Promise<FailoverAttemptResult<string>>>()
      .mockResolvedValueOnce(BAD_KEY())
      .mockResolvedValueOnce(fail('HTTP_503'));

    const outcome = await runWithFailover(MIXED, attempt);

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    // The last failure is the one the user must act on, and it is the outage — not the key.
    expect(outcome.failure.category).toBe('provider-unavailable');
    expect(outcome.reason).toBe('exhausted');
    expect(outcome.attempts.map((a) => a.failure.category)).toEqual([
      'invalid-api-key',
      'provider-unavailable',
    ]);
  });

  it('still contacts a provider whose key was NOT the one refused, whatever the order', async () => {
    // Gemini first this time: the skip is keyed on the provider that actually failed, never on a
    // position in the list.
    const REVERSED: [FailoverCandidate, ...FailoverCandidate[]] = [
      { provider: 'gemini', model: 'gemini-2.5-flash' },
      { provider: 'openrouter', model: 'or-a' },
      { provider: 'openrouter', model: 'or-b' },
    ];
    const asked: string[] = [];
    const attempt = vi.fn((candidate: FailoverCandidate) => {
      asked.push(candidate.provider);
      return Promise.resolve(
        candidate.provider === 'gemini' ? BAD_KEY() : { ok: true as const, value: 'ok' },
      );
    });

    const outcome = await runWithFailover(REVERSED, attempt);
    expect(asked).toEqual(['gemini', 'openrouter']);
    expect(outcome.ok).toBe(true);
  });

  it('an out-of-credits account still stops everything — it is not a per-provider key', async () => {
    // The distinction that must survive this change: a refused KEY is per-provider, an exhausted
    // BALANCE is not, and only the first is worth carrying to the next candidate.
    const attempt = vi.fn(() => Promise.resolve(fail('HTTP_402')));
    const outcome = await runWithFailover(MIXED, attempt);
    expect(attempt).toHaveBeenCalledTimes(1);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toBe('non-retryable');
  });
});
