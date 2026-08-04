import { describe, expect, it } from 'vitest';

import { isAllowanceExhausted, normaliseReset, readRateLimit } from './rate-limit.js';

/**
 * Reading a 429's real numbers, from the real response.
 *
 * Every case below is the shape of an actual provider reply. The point of the parser is that a
 * missing field stays MISSING: an invented reset time is worse than none, because the user plans
 * around it and comes back to find the allowance still gone.
 */
function headers(values: Record<string, string>): { get(name: string): string | null } {
  const lower = new Map(Object.entries(values).map(([k, v]) => [k.toLowerCase(), v]));
  return { get: (name: string) => lower.get(name.toLowerCase()) ?? null };
}

/** The exact 429 OpenRouter returned during diagnosis, headers and body. */
const OPENROUTER_BODY = JSON.stringify({
  error: {
    message: 'Rate limit exceeded: free-models-per-day. Add 10 credits to unlock 1000 free model requests per day',
    code: 429,
    metadata: {
      headers: {
        'X-RateLimit-Limit': '50',
        'X-RateLimit-Remaining': '0',
        'X-RateLimit-Reset': '1785888000000',
      },
      limit_source: 'openrouter_free_tier_daily',
      remedy_hint: 'Wait for the daily reset (see X-RateLimit-Reset), or purchase credits to raise your free-model daily limit.',
    },
  },
});

describe('readRateLimit — the real OpenRouter 429', () => {
  const facts = readRateLimit(
    headers({
      'content-type': 'application/json',
      'x-ratelimit-limit': '50',
      'x-ratelimit-remaining': '0',
      'x-ratelimit-reset': '1785888000000',
    }),
    OPENROUTER_BODY,
  );

  it('reads the allowance and what is left of it', () => {
    expect(facts.limit).toBe(50);
    expect(facts.remaining).toBe(0);
  });

  it('reads the reset instant, already in milliseconds', () => {
    expect(facts.resetAt).toBe(1785888000000);
    expect(new Date(facts.resetAt ?? 0).toISOString()).toBe('2026-08-05T00:00:00.000Z');
  });

  it('reads which KIND of limit was hit — "too fast" and "out for the day" need different actions', () => {
    expect(facts.source).toBe('openrouter_free_tier_daily');
  });

  it("carries the provider's own remedy rather than inventing advice", () => {
    expect(facts.remedy).toMatch(/purchase credits/i);
  });

  it('recognises a spent allowance', () => {
    expect(isAllowanceExhausted(facts)).toBe(true);
  });
});

describe('readRateLimit — degrades honestly', () => {
  it('reports nothing at all when the provider sent nothing', () => {
    expect(readRateLimit(headers({}), '')).toEqual({});
  });

  it('survives a non-JSON body, keeping the headers', () => {
    const facts = readRateLimit(headers({ 'x-ratelimit-remaining': '3' }), '<html>502</html>');
    expect(facts.remaining).toBe(3);
    expect(facts.source).toBeUndefined();
  });

  it('reads Retry-After, which some providers send INSTEAD of a reset', () => {
    expect(readRateLimit(headers({ 'retry-after': '30' }), '').retryAfterSeconds).toBe(30);
  });

  it('falls back to body-mirrored headers when a proxy stripped the real ones', () => {
    const facts = readRateLimit(headers({}), OPENROUTER_BODY);
    expect(facts.limit).toBe(50);
    expect(facts.remaining).toBe(0);
    expect(facts.resetAt).toBe(1785888000000);
  });

  it('never lets the body override a real header', () => {
    // The header is the live value; the mirrored copy can lag.
    const facts = readRateLimit(headers({ 'x-ratelimit-remaining': '7' }), OPENROUTER_BODY);
    expect(facts.remaining).toBe(7);
  });

  it('reports remaining: 0 rather than dropping it as falsy', () => {
    // The single most important number in the whole response.
    expect(readRateLimit(headers({ 'x-ratelimit-remaining': '0' }), '').remaining).toBe(0);
  });

  it('ignores junk instead of rendering NaN', () => {
    const facts = readRateLimit(headers({ 'x-ratelimit-limit': 'lots', 'retry-after': '' }), '');
    expect(facts.limit).toBeUndefined();
    expect(facts.retryAfterSeconds).toBeUndefined();
  });

  it('also reads the OpenAI-style *-requests header names', () => {
    const facts = readRateLimit(
      headers({ 'x-ratelimit-limit-requests': '500', 'x-ratelimit-remaining-requests': '12' }),
      '',
    );
    expect(facts.limit).toBe(500);
    expect(facts.remaining).toBe(12);
  });
});

describe('normaliseReset — the unit is guessed from magnitude, never assumed', () => {
  const now = 1_700_000_000_000;

  it('passes milliseconds through', () => {
    expect(normaliseReset(1785888000000, now)).toBe(1785888000000);
  });

  it('promotes seconds-since-epoch to milliseconds', () => {
    expect(normaliseReset(1785888000, now)).toBe(1785888000000);
  });

  it('treats a small number as a DURATION from now', () => {
    // GitHub-style `X-RateLimit-Reset: 60` means "in 60 seconds", not 1970.
    expect(normaliseReset(60, now)).toBe(now + 60_000);
  });

  it('rejects absent and nonsensical values rather than rendering 1970', () => {
    expect(normaliseReset(undefined, now)).toBeUndefined();
    expect(normaliseReset(0, now)).toBeUndefined();
    expect(normaliseReset(-5, now)).toBeUndefined();
    expect(normaliseReset(Number.NaN, now)).toBeUndefined();
  });
});
