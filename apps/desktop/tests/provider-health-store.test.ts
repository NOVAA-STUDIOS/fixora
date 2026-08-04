import { describe, expect, it } from 'vitest';

import { createProviderHealthStore } from '../electron/main/ai/provider-health-store.js';

/**
 * Health recorded from traffic that was going to happen anyway.
 *
 * The cheapest health check is the work the user already asked for: every repair ends in a
 * definitive answer about its provider, and that answer is more truthful than a synthetic probe
 * because it IS the workload. These pin that recording, and — more importantly — the two properties
 * that make the feature safe: the 60-second probe floor, and the fact that nothing here can affect
 * whether a repair runs.
 */
function store(startAt = 1_800_000_000_000) {
  let clock = startAt;
  const s = createProviderHealthStore({
    labelFor: (id) => (id === 'openrouter' ? 'OpenRouter' : id),
    now: () => clock,
  });
  return { s, advance: (ms: number) => (clock += ms), at: () => clock };
}

describe('provider health — recorded from real repair traffic', () => {
  it('records a success as connected, with latency and a timestamp', () => {
    const { s, at } = store();
    s.recordSuccess('openrouter', 'gpt-oss-20b:free', 412);

    const health = s.get('openrouter');
    expect(health?.status).toBe('connected');
    expect(health?.latencyMs).toBe(412);
    expect(health?.lastSuccessAt).toBe(at());
    expect(health?.label).toBe('OpenRouter');
  });

  it('records a failure with the classification that caused it', () => {
    const { s, at } = store();
    s.recordFailure('openrouter', 'm', 'quota-exceeded', { remaining: 0, limit: 50, resetAt: 999 });

    const health = s.get('openrouter');
    expect(health?.status).toBe('rate-limited');
    expect(health?.lastFailureCategory).toBe('quota-exceeded');
    expect(health?.lastFailureAt).toBe(at());
    expect(health?.quotaRemaining).toBe(0);
    expect(health?.quotaLimit).toBe(50);
  });

  it('keeps BOTH timestamps — a provider that failed and later recovered has a history', () => {
    const { s, advance } = store();
    s.recordFailure('openrouter', 'm', 'timeout');
    const failedAt = s.get('openrouter')?.lastFailureAt;
    advance(120_000);
    s.recordSuccess('openrouter', 'm', 300);

    const health = s.get('openrouter');
    expect(health?.status).toBe('connected');
    expect(health?.lastFailureAt).toBe(failedAt); // not erased by the recovery
    expect(health?.lastSuccessAt).toBeGreaterThan(failedAt ?? 0);
  });

  it('clears a stale quota reading on success', () => {
    // Otherwise the panel shows "0 remaining" beside a provider that just answered.
    const { s } = store();
    s.recordFailure('openrouter', 'm', 'quota-exceeded', { remaining: 0, limit: 50 });
    s.recordSuccess('openrouter', 'm', 200);
    expect(s.get('openrouter')?.quotaRemaining).toBeNull();
  });

  it('does not erase known quota figures on a failure that carried none', () => {
    const { s } = store();
    s.recordFailure('openrouter', 'm', 'quota-exceeded', { remaining: 3, limit: 50 });
    s.recordFailure('openrouter', 'm', 'timeout');
    expect(s.get('openrouter')?.quotaRemaining).toBe(3);
  });

  it('keeps providers independent', () => {
    const { s } = store();
    s.recordSuccess('openrouter', 'm', 100);
    s.recordFailure('openai', 'm', 'invalid-api-key');
    expect(s.get('openrouter')?.status).toBe('connected');
    expect(s.get('openai')?.status).toBe('unauthorized');
    expect(s.all()).toHaveLength(2);
  });

  it('reports nothing for a provider never seen — never a fabricated "connected"', () => {
    const { s } = store();
    expect(s.get('anthropic')).toBeNull();
  });

  it('follows the model when it changes between runs', () => {
    const { s } = store();
    s.recordSuccess('openrouter', 'model-a', 100);
    s.recordSuccess('openrouter', 'model-b', 100);
    expect(s.get('openrouter')?.model).toBe('model-b');
  });

  it('returns copies, so a caller cannot mutate the store through a read', () => {
    const { s } = store();
    s.recordSuccess('openrouter', 'm', 100);
    const first = s.get('openrouter');
    if (first !== null) first.status = 'offline';
    expect(s.get('openrouter')?.status).toBe('connected');
  });
});

describe('provider health — the 60 second probe floor', () => {
  it('allows a first probe, then refuses inside the window', () => {
    const { s, advance } = store();
    expect(s.mayProbe('openrouter', true)).toBe(true);
    s.markProbed('openrouter');
    expect(s.mayProbe('openrouter', true)).toBe(false);
    advance(59_000);
    expect(s.mayProbe('openrouter', true)).toBe(false);
    advance(1_000);
    expect(s.mayProbe('openrouter', true)).toBe(true);
  });

  it('applies the floor to a FAILED probe too', () => {
    // A failing provider is exactly the one a panel would otherwise hammer.
    const { s } = store();
    s.markProbed('openrouter');
    expect(s.mayProbe('openrouter', true)).toBe(false);
  });

  it('counts ordinary repair traffic against the floor', () => {
    // A repair just contacted the provider; probing a second later would be pure waste.
    const { s } = store();
    s.recordSuccess('openrouter', 'm', 100);
    expect(s.mayProbe('openrouter', true)).toBe(false);
  });

  it('NEVER probes a disabled provider, however stale', () => {
    const { s, advance } = store();
    advance(86_400_000);
    expect(s.mayProbe('openrouter', false)).toBe(false);
  });
});
