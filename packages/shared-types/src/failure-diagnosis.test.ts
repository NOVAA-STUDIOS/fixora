import { describe, expect, it } from 'vitest';

import type { AiFailure } from './ai.js';
import { diagnoseFailure, formatResetIn } from './failure-diagnosis.js';

/**
 * The checklist, and the rule that governs it: never blame Fixora for a decision the provider made.
 *
 * The interesting property is what a 429 PROVES. To be rate limited you must have authenticated (a
 * bad key is 401) and you must have reached the provider (an unreachable host cannot answer with a
 * quota verdict). Saying so turns an alarming dead end into a narrow one — and the negative cases
 * matter just as much: a confident wrong tick is worse than no tick.
 */
function failure(over: Partial<AiFailure> = {}): AiFailure {
  return {
    category: 'quota-exceeded',
    layer: 'provider',
    actions: ['retry-later'],
    provider: 'OpenRouter',
    model: 'openai/gpt-oss-20b:free',
    attempts: [],
    ...over,
  };
}

describe('diagnoseFailure — a 429 proves two things are working', () => {
  const diagnosis = diagnoseFailure(
    failure({
      rateLimit: {
        limit: 50,
        remaining: 0,
        resetAt: 1785888000000,
        source: 'openrouter_free_tier_daily',
      },
    }),
  );

  it('blames the PROVIDER, never Fixora', () => {
    expect(diagnosis.blame).toBe('provider');
  });

  it('confirms the API key is valid — a bad key is 401, not 429', () => {
    const check = diagnosis.checks.find((c) => c.label === 'API key is valid');
    expect(check?.status).toBe('pass');
    expect(check?.detail).toMatch(/401/);
  });

  it('confirms the connection works — the provider answered', () => {
    expect(diagnosis.checks.find((c) => c.label === 'Provider connection works')?.status).toBe('pass');
  });

  it('names the daily quota as the ONE thing that failed', () => {
    const failed = diagnosis.checks.filter((c) => c.status === 'fail');
    expect(failed).toHaveLength(1);
    expect(failed[0]?.label).toBe('Daily free quota exhausted');
    expect(diagnosis.headline).toBe('Daily quota exhausted');
  });

  it("explains the consequence in OUR words, not the provider's marketing", () => {
    // The provider's remedy_hint is vendor upsell copy ("Add 10 credits to unlock 1000...") and is
    // deliberately not carried across the wire. We say what is true and what to do instead.
    const detail = diagnosis.checks.find((c) => c.status === 'fail')?.detail ?? '';
    expect(detail).toMatch(/spent for the day/i);
    expect(detail).not.toMatch(/Add 10 credits/i);
  });

  it('says "Rate limited" for a throttle with allowance remaining', () => {
    // Too fast is a different problem from out-for-the-day, and needs a different action.
    const throttled = diagnoseFailure(
      failure({ category: 'rate-limited', rateLimit: { remaining: 12, retryAfterSeconds: 20 } }),
    );
    expect(throttled.headline).toBe('Rate limited');
  });
});

describe('diagnoseFailure — never a fabricated tick', () => {
  it('marks the key INVALID on a 401, while still confirming the connection', () => {
    const d = diagnoseFailure(failure({ category: 'invalid-api-key', layer: 'configuration' }));
    expect(d.blame).toBe('configuration');
    expect(d.checks.find((c) => c.label === 'API key is valid')?.status).toBe('fail');
    // Still worth saying, so the user does not also start suspecting their network.
    expect(d.checks.find((c) => c.label === 'Provider connection works')?.status).toBe('pass');
  });

  it('reports the key as UNKNOWN when the request never arrived', () => {
    // An unsent request proves nothing about the credential. Ticking it would be a guess.
    const d = diagnoseFailure(failure({ category: 'network-offline' }));
    expect(d.checks.find((c) => c.label === 'API key is valid')?.status).toBe('unknown');
    expect(d.checks.find((c) => c.label === 'Provider connection works')?.status).toBe('fail');
  });

  it('blames the provider for a 5xx', () => {
    const d = diagnoseFailure(failure({ category: 'provider-unavailable' }));
    expect(d.blame).toBe('provider');
    expect(d.checks.some((c) => c.detail.includes('not Fixora'))).toBe(true);
  });

  it('offers NO checklist rather than a fabricated one for an unclassified failure', () => {
    const d = diagnoseFailure(failure({ category: 'unknown-provider-error' }));
    expect(d.checks).toEqual([]);
    expect(d.blame).toBe('provider');
  });

  it('blames Fixora only for a genuine engine fault', () => {
    const d = diagnoseFailure(failure({ category: 'invalid-response', layer: 'engine' }));
    expect(d.blame).toBe('fixora');
  });

  it('never blames Fixora for anything the provider decided', () => {
    for (const category of ['quota-exceeded', 'rate-limited', 'provider-unavailable', 'timeout'] as const) {
      expect(diagnoseFailure(failure({ category })).blame, category).not.toBe('fixora');
    }
  });
});

describe('formatResetIn', () => {
  const now = 1785888000000 - 6.86 * 3600 * 1000;

  it('renders the real reset as hours and minutes', () => {
    expect(formatResetIn(1785888000000, now)).toMatch(/^in 6h 5\dm$/);
  });

  it('renders minutes under an hour, and seconds under a minute', () => {
    expect(formatResetIn(now + 45 * 60_000, now)).toBe('in 45m');
    expect(formatResetIn(now + 30_000, now)).toBe('in 30s');
  });

  it('drops a zero minute remainder', () => {
    expect(formatResetIn(now + 2 * 3600_000, now)).toBe('in 2h');
  });

  it('returns null for a reset already past, rather than a negative duration', () => {
    expect(formatResetIn(now - 1000, now)).toBeNull();
  });
});
