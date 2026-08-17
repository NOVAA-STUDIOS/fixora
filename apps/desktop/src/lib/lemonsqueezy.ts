import type { Plan } from '@fixora/shared-types';

import { invoke } from './bridge.js';

export const PRODUCT_IDS = { go: '1296461', pro: '1296487' } as const;

/**
 * Routed through main (`license:validate`), not a direct `fetch` — the CSP's `connect-src` is
 * `'self'` only (Security §2), so a renderer-side call to api.lemonsqueezy.com would simply be
 * blocked. Main also validates against the product id, so a key for a different LemonSqueezy
 * product can't be replayed to unlock a plan it wasn't purchased for.
 */
export async function validateLicense(
  licenseKey: string,
  productId: string,
): Promise<{ valid: boolean; plan: Plan | null }> {
  const result = await invoke('license:validate', { licenseKey, productId });
  if (!result.ok) return { valid: false, plan: null };
  return result.value;
}
