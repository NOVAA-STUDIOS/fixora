import type { TaskProfile } from '@fixora/shared-types';

import { capabilitiesFor } from './capabilities.js';
import type { CatalogueModel } from './catalogue.js';
import type { FailureCategory } from './failure-model.js';
import type { ProviderFailure } from './failure.js';


/**
 * Provider failover orchestration.
 *
 * When a provider fails in a way that another provider could plausibly survive, Fixora moves to the
 * next candidate itself rather than telling the user to go and change a setting. That is the whole
 * job: this module decides *whether* to move on and *in what order*, and it never touches what a
 * repair is, how it is verified, or whether it may be applied.
 *
 * Two boundaries are deliberate and load-bearing:
 *
 *  - **Failover ends at the provider call.** A candidate that answers ends the loop, even if the
 *    answer later fails to parse or fails verification. Retrying a *verification* failure on another
 *    model would make the verifier's verdict a thing worth shopping around for, which is exactly the
 *    property that makes it trustworthy. The engine, the parser, the verifier and the Apply gate are
 *    untouched by this sprint.
 *  - **The chain is provider-agnostic.** A candidate is an adapter id plus a model, not an OpenRouter
 *    model id. Only one adapter ships today, so the chain is populated from models on the one key —
 *    and since OpenRouter routes each model to a different upstream provider, that is real failover
 *    now. Adding a second adapter later is a change to chain construction, not to this loop.
 */

/** One thing to try: which adapter, and which model on it. */
export interface FailoverCandidate {
  /** Adapter id — `openrouter` today. Kept distinct from the model so a second adapter needs no rework. */
  readonly provider: string;
  readonly model: string;
}

/** A candidate that was tried and failed, kept in order so the log can show the whole walk. */
export interface FailoverAttemptRecord {
  readonly candidate: FailoverCandidate;
  readonly failure: ProviderFailure;
}

/** Why the walk ended without a success. */
export type FailoverStopReason =
  /** Every candidate was tried and every one failed. */
  | 'exhausted'
  /** A failure no other candidate could survive — a bad key fails identically everywhere. */
  | 'non-retryable'
  /** The caller aborted mid-walk. */
  | 'cancelled';

export type FailoverOutcome<T> =
  | {
      readonly ok: true;
      readonly value: T;
      /** Which candidate answered. Not necessarily the first. */
      readonly candidate: FailoverCandidate;
      /** What was tried and failed before it. Empty when the first candidate worked. */
      readonly attempts: readonly FailoverAttemptRecord[];
    }
  | {
      readonly ok: false;
      readonly reason: FailoverStopReason;
      /** The failure to report — the LAST one, which is the one the user's next action must address. */
      readonly failure: ProviderFailure;
      readonly candidate: FailoverCandidate;
      /** Every failed attempt, including the one that ended the walk. */
      readonly attempts: readonly FailoverAttemptRecord[];
    };

/** What one attempt returns. Mirrors the service's stream result, minus everything else it carries. */
export type FailoverAttemptResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly failure: ProviderFailure };

/**
 * The failures worth trying elsewhere.
 *
 * An explicit allow-list rather than "anything with `retryable: true`". Retryable means *this*
 * request could succeed again; failover-eligible means *a different provider* could succeed now.
 * They overlap but are not the same question, and conflating them produces confident nonsense —
 * `network-offline` is retryable and is the clearest case where trying five more candidates is five
 * more ways to fail slowly.
 *
 * Everything absent from this set stops the walk. Notably:
 *
 *  - `invalid-api-key`, `auth-failed` — a rejected key is rejected identically by every candidate on
 *    that adapter. Failing over would turn one clear "fix your key" into N confusing failures.
 *  - `network-offline` — no candidate is reachable. See above.
 *  - `quota-exceeded` — an exhausted account fails everywhere; and per-model allowance exhaustion was
 *    classified non-retryable by an earlier, explicit product decision. Left out on purpose rather
 *    than by omission (see the sprint notes — this is the one case worth revisiting).
 *  - `context-too-large` — a larger-context model WOULD fix it, but that is capability selection, not
 *    failure recovery, and picking one blind is a guess.
 *  - `invalid-response` — the model answered. The pipeline already re-asks once; making unusable
 *    output a failover trigger would change repair behaviour, not provider orchestration.
 */
export const FAILOVER_CATEGORIES: ReadonlySet<FailureCategory> = new Set<FailureCategory>([
  'rate-limited',
  'timeout',
  // 5xx of every flavour — "temporary server errors" and "provider unavailable" are one category.
  'provider-unavailable',
  'model-unavailable',
]);

/** Could a different provider plausibly survive this? */
export function shouldFailover(failure: Pick<ProviderFailure, 'category'>): boolean {
  return FAILOVER_CATEGORIES.has(failure.category);
}

/**
 * Walk the chain until something answers.
 *
 * Stops on the FIRST success — a candidate that answers ends the walk immediately, and no further
 * provider is contacted. Stops equally hard on a non-retryable failure, which is what keeps a bad key
 * from being re-offered to five providers in a row.
 */
export async function runWithFailover<T>(
  candidates: readonly [FailoverCandidate, ...FailoverCandidate[]],
  attempt: (candidate: FailoverCandidate) => Promise<FailoverAttemptResult<T>>,
  options: { signal?: AbortSignal; onFailover?: (record: FailoverAttemptRecord) => void } = {},
): Promise<FailoverOutcome<T>> {
  const attempts: FailoverAttemptRecord[] = [];
  // Read through a call: `signal.aborted` is mutated outside this function's control flow, which
  // TypeScript narrows away on a direct read. Same helper shape used across the codebase.
  const aborted = (): boolean => options.signal?.aborted === true;

  let last: FailoverAttemptRecord | null = null;

  for (const candidate of candidates) {
    if (aborted()) {
      return {
        ok: false,
        reason: 'cancelled',
        failure: (last ?? { failure: CANCELLED_FAILURE }).failure,
        candidate,
        attempts,
      };
    }

    const result = await attempt(candidate);
    if (result.ok) {
      // Stop. Nothing further is contacted — every additional call would cost the user money and
      // latency for an answer already in hand.
      return { ok: true, value: result.value, candidate, attempts };
    }

    const record: FailoverAttemptRecord = { candidate, failure: result.failure };
    last = record;
    // Recorded before the branch, so `attempts` is the complete list of what failed in every
    // outcome. A record that omitted the failure which ENDED the walk would be the one case a
    // support log most needs.
    attempts.push(record);

    if (!shouldFailover(result.failure)) {
      // A failure the rest of the chain would reproduce. Report it now, against the candidate that
      // actually produced it, so the guidance names the right key and the right model.
      return { ok: false, reason: 'non-retryable', failure: result.failure, candidate, attempts };
    }

    options.onFailover?.(record);
  }

  // Everything was tried. Report the LAST failure: it is the most recent state of the world, and it
  // is what the user's next action has to address.
  const final = last as FailoverAttemptRecord;
  return {
    ok: false,
    reason: 'exhausted',
    failure: final.failure,
    candidate: final.candidate,
    attempts,
  };
}

/** Only reachable when a walk is cancelled before its first attempt produced anything. */
const CANCELLED_FAILURE: ProviderFailure = {
  kind: 'provider',
  category: 'timeout',
  layer: 'provider',
  message: 'The request was cancelled before any provider answered.',
  retryable: true,
  actions: ['retry'],
  providerCode: 'CANCELLED',
};

/**
 * Build the ordered chain for one run.
 *
 * The user's configured model is ALWAYS first and is never filtered out. It is an explicit choice,
 * and silently demoting it because our capability metadata disagrees would be the tool overruling the
 * user on a judgement it is not entitled to make. Fallbacks are a different matter: they are Fixora's
 * suggestions, so they are filtered to models the catalogue says can actually do the job.
 *
 * `limit` bounds the walk. Failover trades latency for success, and an unbounded chain against a
 * widespread outage would spend a minute failing — three attempts is enough to clear a single bad
 * model or a single overloaded upstream, which is what this is for.
 */
export function buildFailoverChain(input: {
  provider: string;
  /** The user's selected model. Always the head of the chain. */
  configured: string;
  /** Ordered fallbacks, best first. */
  preferred: readonly string[];
  /** Live catalogue, for availability and capability. Empty means "unknown" — fallbacks are dropped. */
  catalogue: readonly CatalogueModel[];
  /** The task being attempted; `repair` and `test` need structured output, `explain` does not. */
  profile: TaskProfile;
  limit?: number;
}): [FailoverCandidate, ...FailoverCandidate[]] {
  const limit = Math.max(1, input.limit ?? 3);
  const head: FailoverCandidate = { provider: input.provider, model: input.configured };
  const chain: FailoverCandidate[] = [head];
  const seen = new Set([input.configured]);

  for (const model of input.preferred) {
    if (chain.length >= limit) break;
    if (seen.has(model)) continue;

    const entry = input.catalogue.find((m) => m.id === model);
    // Absent from the catalogue: retired, or the catalogue is unreachable. Either way we cannot
    // claim it will work, and a fallback that fails is worse than no fallback — it costs a round
    // trip to learn what we could have known here.
    if (entry === undefined) continue;
    // A model that cannot do what this profile needs will fail every time. Offering it as a fallback
    // would spend a request to rediscover a fact the provider already published.
    if (!capabilitiesFor(entry).profiles[input.profile].supported) continue;

    seen.add(model);
    chain.push({ provider: input.provider, model });
  }

  return chain as [FailoverCandidate, ...FailoverCandidate[]];
}
