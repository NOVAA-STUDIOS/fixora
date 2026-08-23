import type { Plan } from '@fixora/shared-types';

import { getLicenseKey, getPlan, isRevalidationDue, recordValidation, revokePlan } from './repair-limit.js';

/**
 * Periodic licence re-verification.
 *
 * A key was checked once, at activation, and then trusted forever — so a refunded, charged-back or
 * publicly shared key kept unlocking PRO indefinitely. This re-asks Gumroad on a daily cadence.
 *
 * The failure policy is the whole design. Only a definitive "this key is not valid" revokes; every
 * ambiguous outcome — offline, DNS failure, Gumroad down, a 500, a response we cannot parse —
 * leaves the plan exactly as it was. Downgrading a paying customer because their train went into a
 * tunnel is a worse error than letting a refunded key run one more day, and it is the error the
 * user cannot do anything about.
 */

const VERIFY_URL = 'https://api.gumroad.com/v2/licenses/verify';

/** Same permalinks the activation path uses. A key is only ever checked against the product its
 *  plan corresponds to, so a GO key cannot re-validate itself into PRO. */
const PLAN_PERMALINK: Record<Exclude<Plan, 'free'>, string> = {
  go: 'euprne',
  pro: 'bqbxp',
};

/** How long to wait before giving up. An unreachable Gumroad must not hold anything open. */
const TIMEOUT_MS = 10_000;

export type RevalidationOutcome = 'not-due' | 'valid' | 'revoked' | 'skipped';

export async function revalidateIfDue(): Promise<RevalidationOutcome> {
  if (!isRevalidationDue()) return 'not-due';

  const plan = getPlan();
  const licenseKey = getLicenseKey();
  if (plan === 'free' || licenseKey === null) return 'not-due';

  const permalink = PLAN_PERMALINK[plan];

  try {
    const response = await fetch(VERIFY_URL, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        product_permalink: permalink,
        license_key: licenseKey,
        // Never increments the seat count: this is a background health check the user did not ask
        // for, and inflating their usage total every day would be our bug showing up in their
        // Gumroad dashboard.
        increment_uses_count: 'false',
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    // A non-404 error status says something about GUMROAD, not about the key. 404 is the one that
    // means "no such licence for this product" — the definitive answer.
    if (!response.ok && response.status !== 404) {
      console.error('[license] revalidation inconclusive — leaving plan unchanged', {
        status: response.status,
      });
      return 'skipped';
    }

    const body = (await response.json()) as { success?: boolean };
    if (body.success === true) {
      recordValidation(plan, licenseKey);
      console.error('[license] revalidated', { plan });
      return 'valid';
    }

    console.error('[license] licence rejected by Gumroad — reverting to free', { plan });
    revokePlan();
    return 'revoked';
  } catch (error) {
    // Offline, timed out, TLS failure, unparseable body. All inconclusive, all leave the plan alone.
    console.error('[license] revalidation could not complete — leaving plan unchanged', {
      message: error instanceof Error ? error.message : String(error),
    });
    return 'skipped';
  }
}
