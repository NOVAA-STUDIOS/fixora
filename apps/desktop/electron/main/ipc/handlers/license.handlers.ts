import type { SqliteDriver } from '../../db/driver.js';
import {
  getRepairCount,
  getWindowResetsAt,
  initRepairLimit,
  REPAIR_WINDOW_MS,
  resetIfWindowElapsed,
  recordValidation,
} from '../../lib/repair-limit.js';
import { registerHandler } from '../router.js';

const VALIDATE_URL = 'https://api.gumroad.com/v2/licenses/verify';
const PERMALINK_TO_PLAN: Record<string, 'go' | 'pro'> = {
  euprne: 'go',
  bqbxp: 'pro',
};

/** Checked well inside the 3h window, so an app left open still rolls over close to on time
 * rather than waiting for the next repair to notice. */
function scheduleWindowReset(): void {
  setInterval(resetIfWindowElapsed, 5 * 60 * 1000);
}

export function registerLicenseHandlers(deps: { driver: SqliteDriver; dir: string }): void {
  // Counter AND plan both live in `repair-limit.ts` now — the one place `ai:run` and
  // `mcp:repairFinding` gate on, so there is exactly one allowance and one owner of it.
  initRepairLimit(deps.driver, deps.dir);
  scheduleWindowReset();

  registerHandler('license:validate', async ({ licenseKey, productId: productPermalink }) => {
    const plan = PERMALINK_TO_PLAN[productPermalink];
    if (plan === undefined) return { valid: false, plan: null };

    try {
      const res = await fetch(VALIDATE_URL, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ product_permalink: productPermalink, license_key: licenseKey }),
      });
      if (!res.ok) return { valid: false, plan: null };
      const body = (await res.json()) as { success?: boolean };
      // The permalink is already scoped to this exact product in the request itself, so a
      // successful response can only mean a key for this product — no separate id check needed.
      if (body.success !== true) return { valid: false, plan: null };
      // Persisted MAIN-side: this is what `checkAndIncrementRepairLimit` reads. The renderer's own
      // copy is for UI only and is not trusted for enforcement. The key and the timestamp travel
      // with it so `revalidateIfDue` can re-check this exact licence a day from now.
      recordValidation(plan, licenseKey);
      return { valid: true, plan };
    } catch (error) {
      console.error('[license] validate request failed', { message: (error as Error).message });
      return { valid: false, plan: null };
    }
  });

  // `getRepairCount` first: it rolls the window over if it has elapsed, so `resetsAt` is read from
  // the CURRENT window rather than the expired one.
  registerHandler('license:getRepairCount', () => {
    const repairsToday = getRepairCount();
    const raw = getWindowResetsAt();
    // Belt to `getWindowResetsAt`'s braces. The contract says this is a non-negative integer, so a
    // non-finite value would fail response validation and surface as a generic IPC error rather
    // than a wrong countdown — worse to debug, and still a broken display either way.
    const resetsAt = Number.isFinite(raw) ? Math.round(raw) : Date.now() + REPAIR_WINDOW_MS;
    if (!Number.isFinite(raw)) {
      console.error('[license] getWindowResetsAt returned a non-finite value', { raw });
    }
    return { repairsToday, resetsAt };
  });
}
