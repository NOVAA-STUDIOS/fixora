import { createPublicKey, verify as cryptoVerify } from 'node:crypto';

import { LicensePayloadSchema, type LicensePayload } from '@fixora/shared-types';

/**
 * Offline license verification (Beta). A license is `base64url(payloadJSON).base64url(ed25519sig)`; we
 * verify the signature against the embedded public key, then validate the payload and its expiry. Pure
 * and dependency-free (node:crypto only) so the check that decides "Pro" is deterministic and testable.
 *
 * The signature is over the exact payload bytes, so any tampering — a changed plan, a later expiry — is
 * a signature failure. The private key that produces these signatures lives with the owner, never here.
 */

export type VerifyResult =
  | { valid: true; payload: LicensePayload }
  | {
      valid: false;
      reason: 'licensing-not-configured' | 'malformed' | 'bad-signature' | 'expired';
    };

function base64urlToBuffer(value: string): Buffer {
  return Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

export function verifyLicense(
  publicKeyDerB64: string,
  license: string,
  now: number = Date.now(),
): VerifyResult {
  if (publicKeyDerB64.trim() === '') return { valid: false, reason: 'licensing-not-configured' };

  const parts = license.trim().split('.');
  if (parts.length !== 2) return { valid: false, reason: 'malformed' };
  const [payloadB64, sigB64] = parts;
  if (payloadB64 === undefined || sigB64 === undefined)
    return { valid: false, reason: 'malformed' };

  let payloadBytes: Buffer;
  let signature: Buffer;
  try {
    payloadBytes = base64urlToBuffer(payloadB64);
    signature = base64urlToBuffer(sigB64);
  } catch {
    return { valid: false, reason: 'malformed' };
  }

  let publicKey;
  try {
    publicKey = createPublicKey({
      key: Buffer.from(publicKeyDerB64, 'base64'),
      format: 'der',
      type: 'spki',
    });
  } catch {
    return { valid: false, reason: 'licensing-not-configured' };
  }

  let signatureOk: boolean;
  try {
    signatureOk = cryptoVerify(null, payloadBytes, publicKey, signature);
  } catch {
    signatureOk = false;
  }
  if (!signatureOk) return { valid: false, reason: 'bad-signature' };

  let json: unknown;
  try {
    json = JSON.parse(payloadBytes.toString('utf8'));
  } catch {
    return { valid: false, reason: 'malformed' };
  }
  const parsed = LicensePayloadSchema.safeParse(json);
  if (!parsed.success) return { valid: false, reason: 'malformed' };

  if (parsed.data.expiresAt !== null && parsed.data.expiresAt < now) {
    return { valid: false, reason: 'expired' };
  }
  return { valid: true, payload: parsed.data };
}
