import { describeProviderFailure } from '@fixora/core-ai';
import { AiFailureSchema } from '@fixora/shared-types';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  logProviderFailure,
  missingKeyFailure,
  providerLabel,
  timeoutFailure,
  toWireFailure,
} from '../electron/main/ai/failure-report.js';

/**
 * The split that this whole feature rests on: the user half crosses IPC, the diagnostic half goes to
 * the developer log and nowhere else.
 *
 * Worth testing as a boundary rather than as two functions, because the failure mode is asymmetric.
 * A diagnostic field that leaks onto the wire is a privacy and trust problem that no reviewer will
 * notice in a diff; a user field missing from the log is merely inconvenient.
 */

const context = { provider: 'openrouter', model: 'anthropic/claude-3.5-sonnet' };

afterEach(() => {
  vi.restoreAllMocks();
});

describe('toWireFailure — what crosses the boundary', () => {
  it('carries the classification, the provider and the model', () => {
    const wire = toWireFailure(describeProviderFailure({ providerCode: 'HTTP_402' }), context);
    expect(wire.category).toBe('quota-exceeded');
    expect(wire.layer).toBe('configuration');
    expect(wire.provider).toBe('OpenRouter'); // the display name, not the internal id
    expect(wire.model).toBe('anthropic/claude-3.5-sonnet');
    expect(AiFailureSchema.safeParse(wire).success).toBe(true);
  });

  /**
   * Pinned as an exact key allow-list rather than a search for suspicious values. A search passes
   * right up until someone adds a field whose value happens to look innocuous in the one test case
   * written for it; an allow-list fails the moment a new key appears, which is the point.
   */
  it('carries NOTHING else — no status code, request id, latency, or provider text', () => {
    const wire = toWireFailure(
      describeProviderFailure({
        providerCode: 'HTTP_429',
        detail: '429 Too Many Requests — Rate limit exceeded: free-models-per-day',
      }),
      context,
    );
    // Six keys, all renderable. `attempts` was added when automatic failover shipped: it carries
    // model ids and classifications for the consolidated card, and — like every other field here —
    // has no room for a status code, a request id, a latency or the provider's own words.
    // `rateLimit` and `dashboardUrl` were added by the provider-diagnostics sprint. Both are safe by
    // this test's own rule: rateLimit carries NUMBERS plus a short machine token (the limit's name),
    // and dashboardUrl is a static URL from our own provider descriptor. The provider's free-text
    // remedy is deliberately not carried — it is unbounded vendor prose, which is exactly what this
    // allow-list exists to keep out.
    expect(Object.keys(wire).sort()).toEqual(
      ['actions', 'attempts', 'category', 'dashboardUrl', 'layer', 'model', 'provider'].sort(),
    );
    expect(JSON.stringify(wire)).not.toContain('429');
    expect(JSON.stringify(wire)).not.toContain('Too Many Requests');
  });

  /**
   * The rate-limit facts are the one payload added since, and they are numbers plus a short machine
   * token — never the provider's prose. The provider's own `remedy_hint` is unbounded vendor copy
   * ("Add 10 credits to unlock 1000 free model requests per day") and is deliberately dropped at the
   * boundary; Fixora says what to do in its own words instead.
   */
  it('carries rate-limit NUMBERS when present, and none of the provider’s prose', () => {
    const wire = toWireFailure(
      describeProviderFailure({
        providerCode: 'HTTP_429',
        detail: '429 Too Many Requests — Rate limit exceeded: free-models-per-day',
        rateLimit: {
          limit: 50,
          remaining: 0,
          resetAt: 1785888000000,
          source: 'openrouter_free_tier_daily',
          remedy: 'Add 10 credits to unlock 1000 free model requests per day',
        },
      }),
      context,
    );

    expect(wire.rateLimit).toEqual({
      limit: 50,
      remaining: 0,
      resetAt: 1785888000000,
      source: 'openrouter_free_tier_daily',
    });
    // The upsell never crosses.
    expect(JSON.stringify(wire)).not.toContain('Add 10 credits');
    expect(JSON.stringify(wire)).not.toContain('429');
  });

  it('never crosses with an empty action list — the wire schema would reject it', () => {
    for (const code of ['HTTP_429', 'HTTP_401', 'HTTP_404', 'HTTP_500', 'NETWORK', 'WEIRD']) {
      const wire = toWireFailure(describeProviderFailure({ providerCode: code }), context);
      expect(AiFailureSchema.safeParse(wire).success, code).toBe(true);
      expect(wire.actions.length, code).toBeGreaterThan(0);
    }
  });
});

describe('logProviderFailure — what does not', () => {
  it('logs every diagnostic field an engineer needs to chase the failure', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const failure = describeProviderFailure({ providerCode: 'HTTP_429', detail: 'slow down' });
    logProviderFailure(failure, {
      provider: 'openrouter',
      model: 'x/y',
      status: 429,
      errorCode: 'HTTP_429',
      latencyMs: 1234,
      requestId: 'req_abc123',
      retryable: true,
      detail: 'slow down',
    });

    expect(spy).toHaveBeenCalledOnce();
    const [, payload] = spy.mock.calls[0] as [string, Record<string, unknown>];
    // The list from the requirements, verbatim.
    expect(payload['provider']).toBe('openrouter');
    expect(payload['model']).toBe('x/y');
    expect(payload['status']).toBe(429);
    expect(payload['errorCode']).toBe('HTTP_429');
    expect(payload['latencyMs']).toBe(1234);
    expect(payload['requestId']).toBe('req_abc123');
    expect(payload['retryable']).toBe(true);
    // Plus the classification, so a log line explains itself without re-deriving it.
    expect(payload['category']).toBe('rate-limited');
    expect(payload['severity']).toBe('warning');
    // The provider's raw words live here, and only here.
    expect(payload['providerMessage']).toBe('slow down');
  });
});

describe('failures Fixora detects itself', () => {
  it('a missing key is a configuration failure that points at Settings', () => {
    const wire = missingKeyFailure();
    expect(wire.layer).toBe('configuration');
    expect(wire.actions).toContain('open-settings');
    expect(AiFailureSchema.safeParse(wire).success).toBe(true);
  });

  it('names NO provider when nothing was contacted', () => {
    // It used to report OpenRouter unconditionally, which told a user who had configured Gemini
    // that OpenRouter had rejected their key — a provider that never saw the request.
    const wire = missingKeyFailure();
    expect(wire.provider).toBeNull();
    expect(wire.model).toBeNull();
  });

  it('a run that exceeded its own deadline is attributed to the provider, not to Fixora', () => {
    const wire = timeoutFailure(context);
    expect(wire.category).toBe('timeout');
    // The deadline is ours; the silence that ran it out is theirs. Blaming the engine here would
    // send users to file a hang bug against a component that was waiting correctly.
    expect(wire.layer).toBe('provider');
    expect(wire.actions.length).toBeGreaterThan(0);
  });
});

describe('the failover walk on the wire', () => {
  it('carries each attempted model with its classification, and nothing else', () => {
    const wire = toWireFailure(describeProviderFailure({ providerCode: 'HTTP_429' }), {
      ...context,
      attempts: [
        { model: 'first/model', category: 'quota-exceeded' },
        { model: 'second/model', category: 'provider-unavailable' },
      ],
    });
    expect(wire.attempts).toHaveLength(2);
    // Exactly two keys per entry — no status codes, no request ids, no provider prose.
    for (const attempt of wire.attempts) {
      expect(Object.keys(attempt).sort()).toEqual(['category', 'model']);
    }
    expect(AiFailureSchema.safeParse(wire).success).toBe(true);
  });

  it('is empty when there was no walk — the common case stays a plain card', () => {
    const wire = toWireFailure(describeProviderFailure({ providerCode: 'HTTP_503' }), context);
    expect(wire.attempts).toEqual([]);
  });
});

/**
 * Display names come from the descriptor, for every provider.
 *
 * `providerLabel` was a hardcoded `{openrouter: 'OpenRouter'}` map from when one provider shipped.
 * Every provider added since rendered as a raw id, so a user with a Claude failure saw "anthropic"
 * on the card and "Anthropic (Claude)" in Settings — for the same thing.
 */
describe('providerLabel — one source of truth for all 8 providers', () => {
  it('names every registered provider from its descriptor', () => {
    expect(providerLabel('openrouter')).toBe('OpenRouter');
    expect(providerLabel('openai')).toBe('OpenAI');
    expect(providerLabel('anthropic')).toBe('Anthropic (Claude)');
    expect(providerLabel('gemini')).toBe('Google Gemini');
    expect(providerLabel('groq')).toBe('Groq');
    expect(providerLabel('azure-openai')).toBe('Azure OpenAI');
    expect(providerLabel('ollama')).toBe('Ollama (local)');
    expect(providerLabel('lmstudio')).toBe('LM Studio (local)');
  });

  it('falls back to the id for a provider the catalogue no longer knows', () => {
    // A downgrade past a provider the install once had. It should still name itself, not render blank.
    expect(providerLabel('provider-from-the-future')).toBe('provider-from-the-future');
  });
});
