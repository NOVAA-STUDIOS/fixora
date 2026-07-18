import type { LicenseService } from '../../license/license-service.js';
import { registerHandler } from '../router.js';

/**
 * License handlers (Beta). Offline entitlement: `activate` verifies a signed key against the embedded
 * public key and returns the resulting status; `get` reports the current entitlement; `deactivate`
 * clears it. No network, no secret crosses the boundary — the key is signed, not confidential.
 */
export function registerLicenseHandlers(deps: { license: LicenseService }): void {
  registerHandler('license:get', () => deps.license.getStatus());
  registerHandler('license:activate', ({ key }) => deps.license.activate(key));
  registerHandler('license:deactivate', () => deps.license.deactivate());
}
