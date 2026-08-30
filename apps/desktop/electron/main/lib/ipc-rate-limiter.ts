/**
 * Per-channel rate limiting for the heavy IPC calls.
 *
 * The renderer is untrusted (invariant I1), and three channels cost real, unrecoverable resources
 * when called in a loop: `ai:run` spends the user's own provider credits, `terminal:create` spawns
 * an OS process, and `analysis:run` starts a whole-repo walk. Nothing bounded any of them, so a
 * compromised renderer — or an ordinary bug that fires a request in a render loop — could burn
 * money or exhaust the process table before anyone noticed.
 *
 * A fixed-window counter, not a token bucket: the limits here are coarse (per minute) and a window
 * is trivially auditable — "how many calls landed in this minute" is a question with one answer,
 * where a bucket's refill rate has to be reasoned about. Nothing here is a security boundary on its
 * own; it is a ceiling on damage.
 */

export interface RateLimit {
  /** Calls permitted per window. */
  readonly max: number;
  readonly windowMs: number;
}

/** Only the channels that cost something real. Everything else is unmetered by design. */
export const RATE_LIMITS: Record<string, RateLimit> = {
  'ai:run': { max: 10, windowMs: 60_000 },
  'terminal:create': { max: 50, windowMs: 30_000 },
  'analysis:run': { max: 3, windowMs: 60_000 },
};

interface Window {
  count: number;
  startedAt: number;
}

const windows = new Map<string, Window>();

export interface RateLimitResult {
  readonly allowed: boolean;
  /** Whole seconds until the current window rolls over. Only meaningful when refused. */
  readonly retryAfter: number;
}

/**
 * Records a call against `channel` and says whether it may proceed. Channels with no configured
 * limit are always allowed and cost nothing.
 */
export function checkRateLimit(channel: string, now: number = Date.now()): RateLimitResult {
  const limit = RATE_LIMITS[channel];
  if (limit === undefined) return { allowed: true, retryAfter: 0 };

  const existing = windows.get(channel);
  if (existing === undefined || now - existing.startedAt >= limit.windowMs) {
    windows.set(channel, { count: 1, startedAt: now });
    return { allowed: true, retryAfter: 0 };
  }

  if (existing.count >= limit.max) {
    const remainingMs = limit.windowMs - (now - existing.startedAt);
    return { allowed: false, retryAfter: Math.max(1, Math.ceil(remainingMs / 1000)) };
  }

  existing.count += 1;
  return { allowed: true, retryAfter: 0 };
}

/** Test seam — the windows are module state, and a test must be able to start from a known one. */
export function resetRateLimits(): void {
  windows.clear();
}
