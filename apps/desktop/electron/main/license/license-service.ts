import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { FREE_LICENSE, type LicenseStatus } from '@fixora/shared-types';

import { verifyLicense } from './verify.js';

/**
 * The license entitlement the app reads (Beta). It holds the activated key, verifies it offline against
 * the embedded public key, and exposes a `LicenseStatus`. BYOK is free; a valid key is 'pro'. The stored
 * key is signed, not secret, so it lives in plain `license.json`; a corrupt or tampered one degrades to
 * Free with a reason, never a crash and never a false 'pro'.
 *
 * This is the reader the whole app trusts. v1.1 can point it at a gateway-issued entitlement instead of
 * a local key without changing a single call site.
 */

export interface LicenseService {
  getStatus(): LicenseStatus;
  activate(key: string): LicenseStatus;
  deactivate(): LicenseStatus;
}

interface Stored {
  key: string;
}

export function createLicenseService(options: { dir: string; publicKey: string }): LicenseService {
  const file = join(options.dir, 'license.json');

  function loadKey(): string {
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<Stored>;
      return typeof parsed.key === 'string' ? parsed.key : '';
    } catch {
      return '';
    }
  }

  function statusFor(key: string): LicenseStatus {
    if (key === '') return FREE_LICENSE;
    const result = verifyLicense(options.publicKey, key);
    if (!result.valid) return { ...FREE_LICENSE, reason: result.reason };
    return {
      plan: 'pro',
      valid: true,
      licensedTo: result.payload.licensedTo,
      expiresAt: result.payload.expiresAt,
      features: result.payload.features,
      reason: null,
    };
  }

  let key = loadKey();

  return {
    getStatus: () => statusFor(key),

    activate(candidate: string): LicenseStatus {
      const trimmed = candidate.trim();
      const candidateStatus = statusFor(trimmed);
      if (candidateStatus.valid) {
        writeFileSync(file, JSON.stringify({ key: trimmed } satisfies Stored), {
          encoding: 'utf8',
          mode: 0o600,
        });
        key = trimmed;
        return candidateStatus;
      }
      // An invalid key is not stored: the current entitlement is unchanged; we just report why.
      return { ...statusFor(key), reason: candidateStatus.reason };
    },

    deactivate(): LicenseStatus {
      try {
        rmSync(file, { force: true });
      } catch {
        // Nothing to remove is fine.
      }
      key = '';
      return FREE_LICENSE;
    },
  };
}
