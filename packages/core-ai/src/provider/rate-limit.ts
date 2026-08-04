/**
 * The facts behind a 429, extracted from what the provider actually told us.
 *
 * A rate-limit refusal arrives carrying real numbers — how many requests the allowance is, how many
 * remain, when it resets — and Fixora was throwing all of them away and rendering "Quota exceeded".
 * That sentence is true and useless: it does not say whose quota, how long until it returns, or
 * whether the key is even the problem. Users read an unattributed failure as a Fixora defect, so a
 * provider's own rate limit cost us trust we had not actually lost.
 *
 * Everything here is READ from the response. Nothing is estimated, and a field the provider did not
 * send stays absent rather than being guessed — a wrong reset time is worse than no reset time,
 * because the user plans around it.
 */

export interface RateLimitFacts {
  /** Total requests the allowance permits, when the provider reports it. */
  readonly limit?: number;
  /** Requests left. Zero is the interesting value and is reported, never omitted as falsy. */
  readonly remaining?: number;
  /** When the allowance resets, as epoch milliseconds. */
  readonly resetAt?: number;
  /** Seconds to wait, from `Retry-After`. Distinct from `resetAt` — a 429 may carry either or both. */
  readonly retryAfterSeconds?: number;
  /**
   * What kind of limit was hit, in the provider's own words (`openrouter_free_tier_daily`).
   * Rendered verbatim: it distinguishes "too fast" from "out for the day", which need different
   * actions from the user.
   */
  readonly source?: string;
  /** The provider's own suggested remedy, when it offers one. */
  readonly remedy?: string;
}

function toNumber(value: string | null): number | undefined {
  if (value === null || value.trim() === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * Normalise a reset value to epoch milliseconds.
 *
 * Providers disagree on the unit, and guessing wrong turns a 7-hour wait into a 1970 timestamp or a
 * date in the year 58000 — both of which the UI would render with a straight face. The magnitude is
 * the only reliable discriminator, so the ranges are explicit:
 *
 *  - > 1e12  already milliseconds (OpenRouter sends `1785888000000`)
 *  - > 1e9   seconds since epoch  (the Unix convention most APIs use)
 *  - else    a DURATION in seconds from now (GitHub-style `X-RateLimit-Reset: 60`)
 */
export function normaliseReset(value: number | undefined, now: number): number | undefined {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return undefined;
  if (value > 1e12) return value;
  if (value > 1e9) return value * 1000;
  return now + value * 1000;
}

/** The provider's error body, in the shapes seen in the wild. Everything optional by construction. */
interface ErrorBody {
  error?: {
    message?: unknown;
    metadata?: {
      limit_source?: unknown;
      remedy_hint?: unknown;
      headers?: Record<string, unknown>;
    };
  };
}

/**
 * Read the rate-limit facts from a response.
 *
 * Headers first, because they are the standard surface and cheap to parse; the body is consulted
 * only for what headers cannot express — which kind of limit it was, and the provider's own remedy.
 * OpenRouter also mirrors its headers INTO the body, so the body is a fallback when a proxy has
 * stripped them.
 */
export function readRateLimit(
  headers: { get(name: string): string | null },
  body: string,
  now: number = Date.now(),
): RateLimitFacts {
  const facts: {
    limit?: number;
    remaining?: number;
    resetAt?: number;
    retryAfterSeconds?: number;
    source?: string;
    remedy?: string;
  } = {};

  const limit = toNumber(headers.get('x-ratelimit-limit')) ?? toNumber(headers.get('x-ratelimit-limit-requests'));
  const remaining =
    toNumber(headers.get('x-ratelimit-remaining')) ?? toNumber(headers.get('x-ratelimit-remaining-requests'));
  const reset = toNumber(headers.get('x-ratelimit-reset')) ?? toNumber(headers.get('x-ratelimit-reset-requests'));
  const retryAfter = toNumber(headers.get('retry-after'));

  if (limit !== undefined) facts.limit = limit;
  if (remaining !== undefined) facts.remaining = remaining;
  const resetAt = normaliseReset(reset, now);
  if (resetAt !== undefined) facts.resetAt = resetAt;
  if (retryAfter !== undefined) facts.retryAfterSeconds = retryAfter;

  try {
    const parsed = JSON.parse(body) as ErrorBody;
    const metadata = parsed.error?.metadata;
    if (typeof metadata?.limit_source === 'string') facts.source = metadata.limit_source;
    if (typeof metadata?.remedy_hint === 'string') facts.remedy = metadata.remedy_hint;

    // Headers mirrored into the body — used only to fill gaps, never to override a real header.
    const mirrored = metadata?.headers;
    if (mirrored !== undefined) {
      const pick = (name: string): number | undefined => {
        const raw = mirrored[name];
        return typeof raw === 'string' || typeof raw === 'number' ? toNumber(String(raw)) : undefined;
      };
      if (facts.limit === undefined) {
        const v = pick('X-RateLimit-Limit');
        if (v !== undefined) facts.limit = v;
      }
      if (facts.remaining === undefined) {
        const v = pick('X-RateLimit-Remaining');
        if (v !== undefined) facts.remaining = v;
      }
      if (facts.resetAt === undefined) {
        const v = normaliseReset(pick('X-RateLimit-Reset'), now);
        if (v !== undefined) facts.resetAt = v;
      }
    }
  } catch {
    // Not JSON, or an unexpected shape. The headers alone are still a useful answer.
  }

  return facts;
}

/** True when the facts show an allowance that is genuinely spent, rather than a momentary throttle. */
export function isAllowanceExhausted(facts: RateLimitFacts): boolean {
  return facts.remaining === 0;
}
