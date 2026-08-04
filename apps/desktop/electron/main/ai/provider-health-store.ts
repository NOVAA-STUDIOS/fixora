import {
  canProbe,
  statusFromFailure,
  type AiFailureCategory,
  type ProviderHealth,
  type ProviderStatus,
} from '@fixora/shared-types';

/**
 * Provider health, recorded from traffic that was going to happen anyway.
 *
 * The cheapest health check is the work the user already asked for. Every repair ends in a
 * definitive answer about its provider — it worked, or it failed with a classified reason — and that
 * answer is more truthful than any synthetic probe, because it IS the workload. So this store is
 * written to by the repair path as a side effect and read by the UI, and explicit probing exists
 * only to answer for a provider the user has not exercised recently.
 *
 * ## It cannot block a repair
 *
 * Nothing in the repair path reads this. `recordSuccess`/`recordFailure` are one synchronous map
 * write each, called after the outcome is already decided, and they are wrapped by the caller so a
 * throw here could not propagate into a repair. There is no await, no I/O, and no lock. A health
 * record that is stale, missing, or wrong changes nothing about whether a repair runs.
 *
 * ## In memory, deliberately
 *
 * Health is a statement about right now. Persisting it would mean showing a user "Connected" on
 * launch because it was connected yesterday — the exact false reassurance this feature exists to
 * remove. An empty store after a restart honestly reports `unknown`.
 */

export interface ProviderHealthStore {
  /** A repair (or probe) succeeded. `latencyMs` is the observed round trip. */
  recordSuccess(providerId: string, model: string, latencyMs: number): void;
  /** A repair (or probe) failed, with the classification the failure carried. */
  recordFailure(
    providerId: string,
    model: string,
    category: AiFailureCategory,
    rateLimit?: { remaining?: number; limit?: number; resetAt?: number },
  ): void;
  /** Current health for one provider, or null when nothing has ever been recorded. */
  get(providerId: string): ProviderHealth | null;
  /** Everything recorded so far, for the panel. */
  all(): readonly ProviderHealth[];
  /** Whether an explicit probe is permitted now — the 60s floor, plus the disabled check. */
  mayProbe(providerId: string, enabled: boolean): boolean;
  /** Stamp a probe attempt, so the floor applies whether or not the probe succeeded. */
  markProbed(providerId: string): void;
}

/** The mutable record behind one provider. Shaped like the wire type so reads are a copy, not a map. */
interface Entry {
  providerId: string;
  label: string;
  enabled: boolean;
  status: ProviderStatus;
  model: string;
  latencyMs: number | null;
  lastSuccessAt: number | null;
  lastFailureAt: number | null;
  lastFailureCategory: string | null;
  quotaRemaining: number | null;
  quotaLimit: number | null;
  quotaResetAt: number | null;
  checkedAt: number | null;
}

function blank(providerId: string, model: string): Entry {
  return {
    providerId,
    label: providerId,
    enabled: true,
    status: 'unknown',
    model,
    latencyMs: null,
    lastSuccessAt: null,
    lastFailureAt: null,
    lastFailureCategory: null,
    quotaRemaining: null,
    quotaLimit: null,
    quotaResetAt: null,
    checkedAt: null,
  };
}

export function createProviderHealthStore(deps: {
  /** Display name for a provider id. Injected so this module needs no provider catalogue. */
  labelFor?: (providerId: string) => string;
  /** Injected for tests; defaults to the wall clock. */
  now?: () => number;
} = {}): ProviderHealthStore {
  const entries = new Map<string, Entry>();
  const now = deps.now ?? ((): number => Date.now());

  function entry(providerId: string, model: string): Entry {
    const existing = entries.get(providerId);
    if (existing !== undefined) {
      // The model can change between runs (a switch, or auto-routing picking another).
      existing.model = model;
      return existing;
    }
    const created = blank(providerId, model);
    created.label = deps.labelFor?.(providerId) ?? providerId;
    entries.set(providerId, created);
    return created;
  }

  return {
    recordSuccess(providerId, model, latencyMs) {
      const e = entry(providerId, model);
      const at = now();
      e.status = 'connected';
      e.latencyMs = latencyMs;
      e.lastSuccessAt = at;
      e.checkedAt = at;
      // A success proves the allowance was not spent. Clearing a stale quota reading here stops the
      // panel showing "0 remaining" beside a provider that just answered.
      e.quotaRemaining = null;
      e.quotaResetAt = null;
    },

    recordFailure(providerId, model, category, rateLimit) {
      const e = entry(providerId, model);
      const at = now();
      e.status = statusFromFailure(category);
      e.lastFailureAt = at;
      e.lastFailureCategory = category;
      e.checkedAt = at;
      // Only overwrite quota figures the provider actually sent; a failure without them must not
      // erase numbers a previous response established.
      if (rateLimit?.remaining !== undefined) e.quotaRemaining = rateLimit.remaining;
      if (rateLimit?.limit !== undefined) e.quotaLimit = rateLimit.limit;
      if (rateLimit?.resetAt !== undefined) e.quotaResetAt = rateLimit.resetAt;
    },

    get(providerId) {
      const e = entries.get(providerId);
      return e === undefined ? null : { ...e };
    },

    all() {
      return [...entries.values()].map((e) => ({ ...e }));
    },

    mayProbe(providerId, enabled) {
      const e = entries.get(providerId);
      return canProbe({ enabled, checkedAt: e?.checkedAt ?? null }, now());
    },

    markProbed(providerId) {
      const e = entries.get(providerId);
      // Stamped even for a probe that FAILED: the floor exists to bound how often we contact a
      // provider, and a failing provider is precisely the one a panel would otherwise hammer.
      if (e !== undefined) e.checkedAt = now();
      else entries.set(providerId, { ...blank(providerId, ''), checkedAt: now() });
    },
  };
}
