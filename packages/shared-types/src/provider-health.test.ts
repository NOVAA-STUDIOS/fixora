import { describe, expect, it } from 'vitest';

import type { AiFailureCategory } from './ai.js';
import {
  canProbe,
  formatAgo,
  healthColour,
  MIN_PROBE_INTERVAL_MS,
  statusFromFailure,
  statusFromProbe,
  statusLabel,
  type ProviderStatus,
} from './provider-health.js';

/**
 * Provider health, and the two rules that make it safe to have at all.
 *
 * Health exists to answer "why will my repair fail" BEFORE a repair is spent discovering it. That is
 * only worth having if it never becomes a cost of its own: it must not poll aggressively (spending
 * the rate limit it exists to report on) and it must never gate a repair. The probe floor is the
 * mechanism for the first; being a pure observer is the mechanism for the second.
 */
describe('statusFromFailure — reuses the failure taxonomy, never a parallel one', () => {
  const cases: [AiFailureCategory, ProviderStatus][] = [
    ['quota-exceeded', 'rate-limited'],
    ['rate-limited', 'rate-limited'],
    ['invalid-api-key', 'unauthorized'],
    ['auth-failed', 'unauthorized'],
    ['network-offline', 'offline'],
    ['provider-unavailable', 'disconnected'],
    ['model-unavailable', 'disconnected'],
    ['timeout', 'disconnected'],
  ];

  for (const [category, status] of cases) {
    it(`maps ${category} to ${status}`, () => {
      expect(statusFromFailure(category)).toBe(status);
    });
  }

  it('keeps a provider CONNECTED when only the model output was bad', () => {
    // The provider answered and behaved. Marking it unhealthy would show red for a working provider.
    for (const category of ['invalid-response', 'context-too-large', 'unknown-provider-error'] as const) {
      expect(statusFromFailure(category), category).toBe('connected');
    }
  });
});

describe('statusFromProbe', () => {
  it('reports connected when every axis passed', () => {
    expect(statusFromProbe({ reachable: true, authenticated: true, modelAvailable: true })).toBe('connected');
  });

  it('reports offline when nothing answered', () => {
    expect(statusFromProbe({ reachable: false, authenticated: null, modelAvailable: null })).toBe('offline');
  });

  it('reports unauthorized when the credential was refused', () => {
    expect(statusFromProbe({ reachable: true, authenticated: false, modelAvailable: null })).toBe('unauthorized');
  });

  it('reports disconnected when the model is gone', () => {
    expect(statusFromProbe({ reachable: true, authenticated: true, modelAvailable: false })).toBe('disconnected');
  });

  it('treats a local provider needing no credential as connected', () => {
    // `authenticated: null` means "no credential required", which must not read as a failure.
    expect(statusFromProbe({ reachable: true, authenticated: null, modelAvailable: true })).toBe('connected');
  });

  it('prefers a classified failure over the raw booleans', () => {
    // The classification is strictly more specific — a 429 is reachable AND authenticated.
    expect(
      statusFromProbe({
        reachable: true,
        authenticated: true,
        modelAvailable: true,
        failureCategory: 'quota-exceeded',
      }),
    ).toBe('rate-limited');
  });
});

describe('healthColour — yellow means "wait", red means "act"', () => {
  it('is green only when the provider is fully working', () => {
    expect(healthColour('connected')).toBe('green');
  });

  it('is yellow for states that clear on their own', () => {
    // Telling a rate-limited user to ACT when waiting is correct is the wrong instruction.
    expect(healthColour('rate-limited')).toBe('yellow');
    expect(healthColour('unknown')).toBe('yellow');
  });

  it('is red for states that need the user to do something', () => {
    // A revoked key must never look temporary.
    for (const status of ['unauthorized', 'disconnected', 'offline'] as const) {
      expect(healthColour(status), status).toBe('red');
    }
  });

  it('names every status', () => {
    for (const status of ['connected', 'rate-limited', 'unauthorized', 'disconnected', 'offline', 'unknown'] as const) {
      expect(statusLabel(status), status).toBeTruthy();
    }
  });
});

describe('canProbe — the 60s floor is enforced in one place', () => {
  const now = 1_800_000_000_000;

  it('allows a first probe', () => {
    expect(canProbe({ enabled: true, checkedAt: null }, now)).toBe(true);
  });

  it('refuses a second probe inside the window', () => {
    // A panel that polls faster spends the rate limit it exists to report on.
    expect(canProbe({ enabled: true, checkedAt: now - 30_000 }, now)).toBe(false);
    expect(canProbe({ enabled: true, checkedAt: now - (MIN_PROBE_INTERVAL_MS - 1) }, now)).toBe(false);
  });

  it('allows a probe once the window has elapsed', () => {
    expect(canProbe({ enabled: true, checkedAt: now - MIN_PROBE_INTERVAL_MS }, now)).toBe(true);
  });

  it('NEVER probes a disabled provider, however stale', () => {
    // The user said not to use it. Spending their allowance on it anyway overrules them.
    expect(canProbe({ enabled: false, checkedAt: null }, now)).toBe(false);
    expect(canProbe({ enabled: false, checkedAt: now - 86_400_000 }, now)).toBe(false);
  });

  it('holds the floor at exactly 60 seconds', () => {
    expect(MIN_PROBE_INTERVAL_MS).toBe(60_000);
  });
});

describe('formatAgo', () => {
  const now = 1_800_000_000_000;

  it('renders an em dash when it has never happened', () => {
    expect(formatAgo(null, now)).toBe('—');
  });

  it('renders minutes, hours and days', () => {
    expect(formatAgo(now - 5 * 60_000, now)).toBe('5m ago');
    expect(formatAgo(now - 3 * 3600_000, now)).toBe('3h ago');
    expect(formatAgo(now - 2 * 86_400_000, now)).toBe('2d ago');
  });

  it('says "just now" under a minute, and never renders a negative age', () => {
    expect(formatAgo(now - 10_000, now)).toBe('just now');
    // Clock skew between a provider timestamp and local time must not produce "-3m ago".
    expect(formatAgo(now + 5_000, now)).toBe('just now');
  });
});
