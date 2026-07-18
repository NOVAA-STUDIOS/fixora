import { z } from 'zod';

/**
 * Licensing (Beta). BYOK is free; a paid **Supporter/Pro** license is an Ed25519-signed token the app
 * verifies **offline** — there is no license server on any path. It is modelled as a generic, verifiable
 * entitlement the app reads, so v1.1 can swap the issuer (a Stripe webhook → the gateway) for the reader
 * without a rewrite. The signed payload is not a secret (it is tied to a buyer and only proves an
 * entitlement); the private signing key lives with the owner, never in the app or the repo.
 */

/** The signed claims inside a license. Only 'pro' is issued in the beta; its absence means 'free'. */
export const LicensePayloadSchema = z.object({
  licenseId: z.string().min(1),
  licensedTo: z.string().min(1),
  plan: z.literal('pro'),
  features: z.array(z.string()).default([]),
  issuedAt: z.number().int(),
  /** null = perpetual (a beta supporter license does not expire). */
  expiresAt: z.number().int().nullable(),
});
export type LicensePayload = z.infer<typeof LicensePayloadSchema>;

/** The entitlement the app reads — the renderer sees this, never the raw key. */
export const LicenseStatusSchema = z.object({
  plan: z.enum(['free', 'pro']),
  valid: z.boolean(),
  licensedTo: z.string().nullable(),
  expiresAt: z.number().int().nullable(),
  features: z.array(z.string()),
  /** Why a supplied key was not accepted (for the UI); null when free or valid. */
  reason: z.string().nullable(),
});
export type LicenseStatus = z.infer<typeof LicenseStatusSchema>;

export const FREE_LICENSE: LicenseStatus = {
  plan: 'free',
  valid: false,
  licensedTo: null,
  expiresAt: null,
  features: [],
  reason: null,
};
