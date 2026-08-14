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
  /**
   * True when this candidate runs on the user's own machine (Ollama, LM Studio).
   *
   * It changes what an unreachable endpoint MEANS, which is the one place locality affects the
   * failover decision — see `shouldFailover`. Optional so existing cloud-only callers are unchanged.
   */
  readonly local?: boolean;
}

/** A candidate that was tried and failed, kept in order so the log can show the whole walk. */
export interface FailoverAttemptRecord<C extends FailoverCandidate = FailoverCandidate> {
  readonly candidate: C;
  readonly failure: ProviderFailure;
}

/**
 * One same-candidate retry, before the walk considers moving to a DIFFERENT provider. Distinct from
 * `FailoverAttemptRecord`: that's "this candidate is done, try the next one"; this is "this exact
 * candidate, once more, after a pause" — for failures where nothing about the candidate is wrong,
 * only the timing (`retryable: true` in failure.ts — a burst rate limit, a timeout, a 5xx, a
 * dropped connection). Retrying the SAME provider is strictly cheaper and faster than failing over
 * to a different one for something that timing alone would fix, and it's the only recovery a
 * single-provider setup has at all — today that case just failed outright.
 */
export interface RetryAttemptRecord<C extends FailoverCandidate = FailoverCandidate> {
  readonly candidate: C;
  readonly attempt: number;
  readonly failure: ProviderFailure;
  readonly delayMs: number;
}

const delay = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      resolve();
    });
  });

/** Why the walk ended without a success. */
export type FailoverStopReason =
  /** Every candidate was tried and every one failed. */
  | 'exhausted'
  /** A failure no other candidate could survive — a bad key fails identically everywhere. */
  | 'non-retryable'
  /** The caller aborted mid-walk. */
  | 'cancelled';

export type FailoverOutcome<T, C extends FailoverCandidate = FailoverCandidate> =
  | {
      readonly ok: true;
      readonly value: T;
      /** Which candidate answered. Not necessarily the first. */
      readonly candidate: C;
      /** What was tried and failed before it. Empty when the first candidate worked. */
      readonly attempts: readonly FailoverAttemptRecord[];
    }
  | {
      readonly ok: false;
      readonly reason: FailoverStopReason;
      /** The failure to report — the LAST one, which is the one the user's next action must address. */
      readonly failure: ProviderFailure;
      readonly candidate: C;
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
 * Everything absent from this set stops the walk, EXCEPT the credential rejections, which get their
 * own narrower treatment — see `failoverScope`. Notably:
 *
 *  - `network-offline` — no candidate is reachable. See above.
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
  // Quota exhaustion, but only the per-model kind — see `shouldFailover` for why the layer decides.
  'quota-exceeded',
]);

/**
 * Could a different provider plausibly survive this?
 *
 * Category alone is not enough for quota, which is the one failure that arrives in two shapes with
 * opposite answers:
 *
 *  - **Per-model allowance exhausted** (HTTP 429 whose body names a daily/free-tier limit) is
 *    `layer: 'provider'`. Another model has its own allowance, so moving on is exactly the fix — this
 *    is the case automatic failover exists for.
 *  - **The account is out of credits** (HTTP 402) is `layer: 'configuration'`. Every candidate draws
 *    on the same balance, so a walk would spend N requests to rediscover one fact and bury the only
 *    thing that helps — add credits — under a pile of identical failures.
 *
 * Reusing `layer` here rather than adding a flag is deliberate: it already encodes "whose problem is
 * this", and "the user's configuration" is precisely the case no other provider can rescue.
 */
/**
 * How far a failure may be carried.
 *
 * Three-valued rather than boolean because a rejected credential is not "stop" and is not "try
 * anything" — it is "try anything that does not present this same key".
 */
export type FailoverScope =
  /** Nothing else could survive this. End the walk here. */
  | 'none'
  /** Only candidates presenting a DIFFERENT credential. Same-provider candidates share the key. */
  | 'different-credential'
  /** Any remaining candidate, in order. */
  | 'any';

/**
 * The credential rejections.
 *
 * These used to end the walk outright, on the reasoning that "a rejected key is rejected identically
 * by every candidate". That was true when a chain was models on ONE key. It is false now that every
 * provider carries its own credential: provider A refusing its key says nothing whatsoever about
 * provider B's, and stopping meant one stale key at priority 1 made every correctly-configured
 * provider behind it unreachable.
 *
 * What remains true is the half that motivated the original rule — presenting the SAME rejected key
 * to the same provider's other models is N ways to be told the same thing. `different-credential`
 * keeps that and drops the part that was over-broad.
 */
const CREDENTIAL_CATEGORIES: ReadonlySet<FailureCategory> = new Set<FailureCategory>([
  'invalid-api-key',
  'auth-failed',
]);

export function failoverScope(
  failure: Pick<ProviderFailure, 'category' | 'layer'>,
  candidate?: { readonly local?: boolean },
): FailoverScope {
  /**
   * An unreachable LOCAL endpoint is not evidence that the internet is down.
   *
   * `network-offline` is excluded from the set above because, for a cloud provider, it is the
   * clearest case where trying five more candidates is five more ways to fail slowly. That reasoning
   * inverts for a daemon on 127.0.0.1: a connection refused there means Ollama or LM Studio is not
   * running, which says precisely nothing about whether OpenRouter is reachable. Without this, a
   * user who puts a local provider first and has not started it gets the whole chain stopped by a
   * process that was never running — the cloud providers below it are never even tried.
   */
  if (failure.category === 'network-offline') return candidate?.local === true ? 'any' : 'none';
  if (CREDENTIAL_CATEGORIES.has(failure.category)) return 'different-credential';
  if (!FAILOVER_CATEGORIES.has(failure.category)) return 'none';
  // The layer check applies to QUOTA ONLY, and deliberately not to the rest of the set.
  // `model-unavailable` is also `layer: 'configuration'` — the user picked a model that no longer
  // exists — yet it is the category another model most obviously rescues. Generalising this guard
  // to every category silently disabled exactly that case.
  if (failure.category === 'quota-exceeded') return failure.layer === 'configuration' ? 'none' : 'any';
  return 'any';
}

/**
 * Whether this failure may be carried past the candidate that produced it at all.
 *
 * A convenience over `failoverScope` for callers asking the yes/no question. It cannot express
 * "only a different credential", so anything WALKING a chain must use `failoverScope` — see
 * `runWithFailover`, which needs to know which candidates to skip rather than merely whether to
 * continue.
 */
export function shouldFailover(
  failure: Pick<ProviderFailure, 'category' | 'layer'>,
  candidate?: { readonly local?: boolean },
): boolean {
  return failoverScope(failure, candidate) !== 'none';
}

/**
 * Walk the chain until something answers.
 *
 * Stops on the FIRST success — a candidate that answers ends the walk immediately, and no further
 * provider is contacted. Stops equally hard on a non-retryable failure, which is what keeps a bad key
 * from being re-offered to five providers in a row.
 */
export async function runWithFailover<T, C extends FailoverCandidate = FailoverCandidate>(
  candidates: readonly [C, ...C[]],
  attempt: (candidate: C) => Promise<FailoverAttemptResult<T>>,
  options: {
    signal?: AbortSignal;
    onFailover?: (record: FailoverAttemptRecord<C>) => void;
    /** Fired once per same-candidate retry, before the delay it names. Optional — a caller that
     * doesn't care how the retry sausage is made just sees a slower, more successful walk. */
    onRetry?: (record: RetryAttemptRecord<C>) => void;
    /**
     * Opt-in: delays (ms) for same-candidate retries on a `retryable: true` failure, tried in
     * order before the walk considers a different provider. Omitted (the default) preserves the
     * walk's original behaviour exactly — one attempt per candidate, straight to the failover
     * decision — so every existing caller and every existing test is unaffected. A caller that
     * wants the recovery a single-provider chain otherwise doesn't have passes e.g. `[1000, 2000]`.
     */
    retryBackoffMs?: readonly number[];
  } = {},
): Promise<FailoverOutcome<T, C>> {
  // Generic over the candidate type so a caller carrying richer candidates — the orchestrator's,
  // which hold a live adapter — gets them back unwidened, with no casts at either end.
  const attempts: FailoverAttemptRecord<C>[] = [];
  // Read through a call: `signal.aborted` is mutated outside this function's control flow, which
  // TypeScript narrows away on a direct read. Same helper shape used across the codebase.
  const aborted = (): boolean => options.signal?.aborted === true;

  let last: FailoverAttemptRecord<C> | null = null;
  /**
   * Providers whose credential has already been rejected this walk.
   *
   * A candidate is skipped without being contacted when its provider is in here: it would present
   * the identical key and be told the identical thing, at the cost of a round trip. Keyed by provider
   * id because that is exactly the granularity credentials are stored at — one key slot per provider.
   */
  const rejectedCredentials = new Set<string>();

  for (const candidate of candidates) {
    if (rejectedCredentials.has(candidate.provider)) continue;

    if (aborted()) {
      return {
        ok: false,
        reason: 'cancelled',
        failure: (last ?? { failure: CANCELLED_FAILURE }).failure,
        candidate,
        attempts,
      };
    }

    let result = await attempt(candidate);

    // Same-candidate backoff, BEFORE the failover decision — only when the caller opted in via
    // `retryBackoffMs`. A failure timing alone would fix (burst rate limit, timeout, 5xx, dropped
    // connection — failure.ts's `retryable: true`) gets up to that many more tries against this
    // exact candidate, rather than immediately being treated as a reason to try a different
    // provider. This is the only recovery a single-provider chain otherwise has at all.
    const backoff = options.retryBackoffMs ?? [];
    for (let i = 0; !result.ok && result.failure.retryable && i < backoff.length; i += 1) {
      if (aborted()) break;
      const delayMs = backoff[i] as number;
      options.onRetry?.({ candidate, attempt: i + 1, failure: result.failure, delayMs });
      await delay(delayMs, options.signal);
      if (aborted()) break;
      result = await attempt(candidate);
    }

    if (result.ok) {
      // Stop. Nothing further is contacted — every additional call would cost the user money and
      // latency for an answer already in hand.
      return { ok: true, value: result.value, candidate, attempts };
    }

    const record: FailoverAttemptRecord<C> = { candidate, failure: result.failure };
    last = record;
    // Recorded before the branch, so `attempts` is the complete list of what failed in every
    // outcome. A record that omitted the failure which ENDED the walk would be the one case a
    // support log most needs.
    attempts.push(record);

    const scope = failoverScope(result.failure, candidate);
    if (scope === 'none') {
      // A failure the rest of the chain would reproduce. Report it now, against the candidate that
      // actually produced it, so the guidance names the right key and the right model.
      return { ok: false, reason: 'non-retryable', failure: result.failure, candidate, attempts };
    }
    if (scope === 'different-credential') {
      // This provider's key was refused. Its other models would present the same key, so they are
      // struck from the walk — but a DIFFERENT provider carries a different key and is still worth
      // trying. If nothing else remains, the loop falls out and reports this failure as `exhausted`.
      rejectedCredentials.add(candidate.provider);
    }

    options.onFailover?.(record);
  }

  // Everything was tried. Report the LAST failure: it is the most recent state of the world, and it
  // is what the user's next action has to address.
  const final = last as FailoverAttemptRecord<C>;
  return {
    ok: false,
    // Ending ON a credential rejection means no candidate with a different key remained — had one
    // been tried, its own failure would be the final record instead. That is "retrying will not
    // help", not "we ran out of things to try", and the two send the user to different places.
    reason:
      failoverScope(final.failure, final.candidate) === 'different-credential'
        ? 'non-retryable'
        : 'exhausted',
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
