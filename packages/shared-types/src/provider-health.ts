import { z } from 'zod';

import type { AiFailureCategory } from './ai.js';

/**
 * Provider health — what each configured provider is actually doing, at a glance.
 *
 * The point is to answer "why is my repair failing" BEFORE the user runs a repair and reads a
 * failure card. A key that was revoked yesterday, a local daemon that is not running, an allowance
 * spent this morning: each of those is knowable in advance, and each currently costs the user a
 * failed repair to discover.
 *
 * ## Two rules this design exists to keep
 *
 * **Health never blocks a repair.** Nothing here is on the repair path. A repair reads the registry
 * and the credential store exactly as it always did; health is an observer that happens to watch the
 * same traffic. A health check that is stale, failed, or has never run cannot delay or refuse a
 * repair — the worst it can do is show "Unknown".
 *
 * **Health is mostly FREE.** Every real repair already produces a definitive answer about a provider:
 * it worked, or it failed with a classified reason. Recording that costs nothing and is more truthful
 * than a synthetic probe, because it is the actual workload. Explicit probes exist only to answer for
 * a provider the user has not exercised, and are rate-limited hard — see `MIN_PROBE_INTERVAL_MS`.
 */

/**
 * The floor between explicit probes of the same provider.
 *
 * Sixty seconds, and it is a product constraint rather than a tuning knob: a health panel that polls
 * aggressively spends the user's rate limit to tell them about their rate limit, which is exactly
 * the failure it exists to prevent. Local providers are no exception — probing a busy Ollama every
 * few seconds competes with the user's own generation for the GPU.
 */
export const MIN_PROBE_INTERVAL_MS = 60_000;

export const ProviderStatusSchema = z.enum([
  /** Reached, authenticated, model usable. */
  'connected',
  /** Reached and authenticated, but the allowance is spent or throttled. */
  'rate-limited',
  /** Reached, and the credential was refused. */
  'unauthorized',
  /** The host answered but is failing — 5xx, or the configured model is gone. */
  'disconnected',
  /** Nothing answered: no network, wrong URL, or a local daemon that is not running. */
  'offline',
  /** Never checked and never used. Deliberately distinct from every failure. */
  'unknown',
]);
export type ProviderStatus = z.infer<typeof ProviderStatusSchema>;

/** Traffic-light colour. Derived from status so the mapping cannot drift per component. */
export type HealthColour = 'green' | 'yellow' | 'red';

export const ProviderHealthSchema = z.object({
  providerId: z.string(),
  label: z.string(),
  /** Whether the user has this provider switched on. A disabled provider is reported, never probed. */
  enabled: z.boolean(),
  status: ProviderStatusSchema,
  /** The model this provider would use for the next repair. */
  model: z.string(),
  /** Round-trip of the most recent successful exchange, in ms. Null when never observed. */
  latencyMs: z.number().nullable(),
  /** Epoch ms of the last success — a real repair or a probe. Null when there has never been one. */
  lastSuccessAt: z.number().nullable(),
  /** Epoch ms of the last failure, with the classification that caused it. */
  lastFailureAt: z.number().nullable(),
  lastFailureCategory: z.string().nullable(),
  /** Requests left in the current allowance, when the provider has told us. */
  quotaRemaining: z.number().nullable(),
  quotaLimit: z.number().nullable(),
  /** Epoch ms when the allowance resets, when known. */
  quotaResetAt: z.number().nullable(),
  /** When this record was last updated, so the UI can say how fresh it is. */
  checkedAt: z.number().nullable(),
});
export type ProviderHealth = z.infer<typeof ProviderHealthSchema>;

const STATUS_LABEL: Record<ProviderStatus, string> = {
  connected: 'Connected',
  'rate-limited': 'Rate Limited',
  unauthorized: 'Unauthorized',
  disconnected: 'Disconnected',
  offline: 'Offline',
  unknown: 'Not checked',
};

export function statusLabel(status: ProviderStatus): string {
  return STATUS_LABEL[status];
}

/**
 * Colour from status.
 *
 * Yellow is deliberately reserved for "working, but degraded or temporarily unavailable" — a state
 * that clears on its own. Red is "will not work until you do something". Collapsing rate-limited
 * into red would tell a user to act when waiting is the correct response, and treating unauthorized
 * as yellow would let a revoked key look temporary.
 */
export function healthColour(status: ProviderStatus): HealthColour {
  switch (status) {
    case 'connected':
      return 'green';
    case 'rate-limited':
    case 'unknown':
      return 'yellow';
    case 'unauthorized':
    case 'disconnected':
    case 'offline':
      return 'red';
  }
}

/**
 * Map a classified failure onto a status.
 *
 * Reuses the failure taxonomy rather than inventing a parallel one, so a provider's health and the
 * error card it produces can never disagree about what went wrong.
 */
export function statusFromFailure(category: AiFailureCategory): ProviderStatus {
  switch (category) {
    case 'quota-exceeded':
    case 'rate-limited':
      return 'rate-limited';
    case 'invalid-api-key':
    case 'auth-failed':
      return 'unauthorized';
    case 'network-offline':
      return 'offline';
    case 'provider-unavailable':
    case 'model-unavailable':
    case 'timeout':
      return 'disconnected';
    // The provider answered and behaved; the model's OUTPUT was the problem. That is not a health
    // fault, and marking it one would show red for a provider that is working perfectly.
    case 'context-too-large':
    case 'invalid-response':
    case 'unknown-provider-error':
      return 'connected';
  }
}

/** Derive a status from a probe result, which reports its axes separately. */
export function statusFromProbe(probe: {
  reachable: boolean;
  authenticated: boolean | null;
  modelAvailable: boolean | null;
  failureCategory?: AiFailureCategory;
}): ProviderStatus {
  // A classified failure is more specific than the booleans, so it wins when present.
  if (probe.failureCategory !== undefined) return statusFromFailure(probe.failureCategory);
  if (!probe.reachable) return 'offline';
  if (probe.authenticated === false) return 'unauthorized';
  if (probe.modelAvailable === false) return 'disconnected';
  return 'connected';
}

/**
 * May this provider be probed now?
 *
 * The floor is enforced here, in one pure function, rather than in whichever caller remembered — a
 * poll loop and a manual refresh button are the same question and must get the same answer.
 * A disabled provider is never probed at all: the user has said they do not want it used, and
 * spending their rate limit on it anyway would be the tool overruling them.
 */
export function canProbe(
  health: Pick<ProviderHealth, 'enabled' | 'checkedAt'>,
  now: number = Date.now(),
): boolean {
  if (!health.enabled) return false;
  if (health.checkedAt === null) return true;
  return now - health.checkedAt >= MIN_PROBE_INTERVAL_MS;
}

/** "2m ago" / "just now" / "—". Relative, because an absolute timestamp needs mental arithmetic. */
export function formatAgo(at: number | null, now: number = Date.now()): string {
  if (at === null) return '—';
  const ms = now - at;
  if (ms < 0) return 'just now';
  if (ms < 60_000) return 'just now';
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${String(minutes)}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${String(hours)}h ago`;
  return `${String(Math.floor(hours / 24))}d ago`;
}
