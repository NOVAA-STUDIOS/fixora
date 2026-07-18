import { generateKeyPairSync, type KeyObject, sign } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createLicenseService } from '../electron/main/license/license-service.js';
import { verifyLicense } from '../electron/main/license/verify.js';

// A real Ed25519 keypair per run — the same crypto the signing script uses.
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const PUBLIC_DER_B64 = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function mint(payload: Record<string, unknown>, key: KeyObject = privateKey): string {
  const bytes = Buffer.from(JSON.stringify(payload), 'utf8');
  return `${b64url(bytes)}.${b64url(sign(null, bytes, key))}`;
}

function proPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    licenseId: 'lic-1',
    licensedTo: 'buyer@example.com',
    plan: 'pro',
    features: ['supporter'],
    issuedAt: Date.now(),
    expiresAt: null,
    ...overrides,
  };
}

describe('license verification (offline Ed25519)', () => {
  it('accepts a genuinely signed, unexpired license', () => {
    const result = verifyLicense(PUBLIC_DER_B64, mint(proPayload()));
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.payload.licensedTo).toBe('buyer@example.com');
    expect(result.payload.plan).toBe('pro');
  });

  it('rejects a tampered payload (upgraded expiry) as a bad signature', () => {
    const license = mint(proPayload({ expiresAt: 100 }));
    const [payloadB64, sigB64] = license.split('.');
    // Re-sign nothing: swap the payload for a longer expiry but keep the old signature.
    const forged = `${b64url(Buffer.from(JSON.stringify(proPayload({ expiresAt: 9_999_999_999_999 }))))}.${sigB64 ?? ''}`;
    expect(payloadB64).not.toBe('');
    expect(verifyLicense(PUBLIC_DER_B64, forged)).toEqual({
      valid: false,
      reason: 'bad-signature',
    });
  });

  it('rejects a license signed by a different key', () => {
    const other = generateKeyPairSync('ed25519').privateKey;
    expect(verifyLicense(PUBLIC_DER_B64, mint(proPayload(), other))).toEqual({
      valid: false,
      reason: 'bad-signature',
    });
  });

  it('rejects an expired license', () => {
    const result = verifyLicense(PUBLIC_DER_B64, mint(proPayload({ expiresAt: 1000 })), 5000);
    expect(result).toEqual({ valid: false, reason: 'expired' });
  });

  it('rejects a malformed key', () => {
    const result = verifyLicense(PUBLIC_DER_B64, 'not-a-license');
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toBe('malformed');
  });

  it('reports not-configured when no public key is embedded', () => {
    expect(verifyLicense('', mint(proPayload()))).toEqual({
      valid: false,
      reason: 'licensing-not-configured',
    });
  });
});

describe('license service', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'fixora-lic-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('starts free, activates a valid key to pro, and persists it', () => {
    const first = createLicenseService({ dir, publicKey: PUBLIC_DER_B64 });
    expect(first.getStatus().plan).toBe('free');

    const status = first.activate(mint(proPayload()));
    expect(status.plan).toBe('pro');
    expect(status.valid).toBe(true);

    // A fresh instance reads the persisted license and is still Pro.
    expect(createLicenseService({ dir, publicKey: PUBLIC_DER_B64 }).getStatus().plan).toBe('pro');
  });

  it('does not store an invalid key and keeps the current entitlement', () => {
    const service = createLicenseService({ dir, publicKey: PUBLIC_DER_B64 });
    service.activate(mint(proPayload())); // become Pro
    const status = service.activate('garbage.key'); // reject a bad key
    expect(status.plan).toBe('pro'); // still Pro
    expect(status.reason).toBe('bad-signature'); // but told why the new key failed
  });

  it('deactivates back to free', () => {
    const service = createLicenseService({ dir, publicKey: PUBLIC_DER_B64 });
    service.activate(mint(proPayload()));
    expect(service.deactivate().plan).toBe('free');
    expect(createLicenseService({ dir, publicKey: PUBLIC_DER_B64 }).getStatus().plan).toBe('free');
  });
});
