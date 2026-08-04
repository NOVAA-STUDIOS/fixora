import type { AiFailure } from './ai.js';

/**
 * What a provider refusal proves, stated as a checklist.
 *
 * "Quota exceeded" is true and useless. It leaves the three questions a user actually has
 * unanswered — is my key wrong, is the provider down, or is this Fixora broken — and in the absence
 * of an answer people assume the tool is broken. That assumption costs trust we have not lost.
 *
 * A 429 is unusually informative and we were throwing the information away. To be rate limited you
 * must have been AUTHENTICATED (a bad key is 401, never 429) and you must have REACHED the provider
 * (an unreachable host cannot answer with a quota verdict). So the same response that reports the
 * failure also proves two things are working, and saying so converts an alarming dead end into a
 * narrow, understandable one.
 *
 * That is the whole idea here: derive what the status code PROVES, not just what it denies.
 */

export type CheckStatus = 'pass' | 'fail' | 'unknown';

export interface DiagnosticCheck {
  readonly label: string;
  readonly status: CheckStatus;
  /** Why this line reads the way it does. Shown as supporting text, never as the headline. */
  readonly detail: string;
}

export interface FailureDiagnosis {
  /**
   * Whose problem this is, in one word the card leads with.
   *
   * `provider` for anything the provider decided — the user must never read a provider's refusal as
   * a Fixora defect. `configuration` for something the user can fix in Settings. `fixora` is
   * reserved for genuine engine faults and is deliberately rare.
   */
  readonly blame: 'provider' | 'configuration' | 'fixora';
  readonly headline: string;
  readonly checks: readonly DiagnosticCheck[];
}

const AUTH_OK: DiagnosticCheck = {
  label: 'API key is valid',
  status: 'pass',
  // The load-bearing inference: an invalid key never reaches a quota decision.
  detail: 'The provider authenticated the request — an invalid key is rejected with 401, not a quota error.',
};

const CONNECTION_OK: DiagnosticCheck = {
  label: 'Provider connection works',
  status: 'pass',
  detail: 'The request reached the provider and it answered.',
};

/**
 * Diagnose a failure into a checklist.
 *
 * Only categories where the status code genuinely proves something get a full checklist. Everything
 * else returns the honest reduced form rather than a fabricated one — asserting "✓ API key is valid"
 * on a timeout would be a guess, and a confident wrong tick is worse than no tick.
 */
export function diagnoseFailure(failure: AiFailure): FailureDiagnosis {
  const { category, rateLimit } = failure;

  if (category === 'quota-exceeded' || category === 'rate-limited') {
    const exhausted = rateLimit?.remaining === 0;
    const daily = rateLimit?.source !== undefined && /day|daily/i.test(rateLimit.source);
    return {
      blame: 'provider',
      headline: exhausted
        ? daily
          ? 'Daily quota exhausted'
          : 'Allowance exhausted'
        : 'Rate limited',
      checks: [
        AUTH_OK,
        CONNECTION_OK,
        {
          label: daily ? 'Daily free quota exhausted' : 'Request allowance exhausted',
          status: 'fail',
          detail: daily
            ? 'The allowance for this key is spent for the day. It returns at the reset time above — or raise the limit with the provider.'
            : 'The provider refused this request because the allowance for this key is spent.',
        },
      ],
    };
  }

  if (category === 'invalid-api-key' || category === 'auth-failed') {
    return {
      blame: 'configuration',
      headline: 'The provider rejected this API key',
      checks: [
        // Reaching a 401 still proves the endpoint is up — worth saying, so the user does not also
        // start suspecting their network.
        CONNECTION_OK,
        {
          label: 'API key is valid',
          status: 'fail',
          detail: 'The provider rejected the credential. It may be mistyped, revoked, or for a different provider.',
        },
      ],
    };
  }

  if (category === 'provider-unavailable') {
    return {
      blame: 'provider',
      headline: 'The provider is having trouble',
      checks: [
        { label: 'Provider connection works', status: 'pass', detail: 'The request reached the provider.' },
        {
          label: 'Provider is healthy',
          status: 'fail',
          detail: 'The provider returned a server error. This is on their side, not Fixora’s.',
        },
      ],
    };
  }

  if (category === 'network-offline') {
    return {
      blame: 'configuration',
      headline: 'The provider could not be reached',
      checks: [
        {
          label: 'Provider connection works',
          status: 'fail',
          detail: 'The request never reached the provider. Check your connection, VPN or proxy.',
        },
        // Genuinely unknown: an unsent request tells us nothing about the credential.
        { label: 'API key is valid', status: 'unknown', detail: 'Not checked — the request never arrived.' },
      ],
    };
  }

  if (category === 'timeout') {
    return {
      blame: 'provider',
      headline: 'The provider did not respond in time',
      checks: [
        { label: 'Provider connection works', status: 'pass', detail: 'The connection was established.' },
        { label: 'Provider responded in time', status: 'fail', detail: 'No complete response arrived before the deadline.' },
      ],
    };
  }

  // Everything else: no checklist rather than a fabricated one.
  return {
    blame: failure.layer === 'engine' ? 'fixora' : failure.layer === 'configuration' ? 'configuration' : 'provider',
    headline: 'The request could not be completed',
    checks: [],
  };
}

/** "in 6h 52m" / "in 45s" — a duration a person can act on, not a timestamp they must subtract. */
export function formatResetIn(resetAt: number, now: number = Date.now()): string | null {
  const ms = resetAt - now;
  if (!Number.isFinite(ms) || ms <= 0) return null;
  // Tested against the raw duration, not against rounded minutes: `Math.round(30_000 / 60_000)` is
  // 1, so rounding first makes the seconds branch unreachable and reports half a minute as "in 1m".
  if (ms < 60_000) return `in ${String(Math.round(ms / 1000))}s`;
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `in ${String(minutes)}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `in ${String(hours)}h` : `in ${String(hours)}h ${String(rest)}m`;
}
