import { z } from 'zod';

/**
 * Licensing. Free tier is rate-limited; GO/PRO are LemonSqueezy-hosted products the app validates
 * online against LemonSqueezy's public license-validate endpoint (no server of our own). Supersedes
 * the earlier offline Ed25519 design — that model assumed a signed, self-verifying token; this one
 * assumes a purchased key checked against LemonSqueezy at activation time.
 */

export const PlanSchema = z.enum(['free', 'go', 'pro']);
export type Plan = z.infer<typeof PlanSchema>;

export const LicenseValidateResultSchema = z.object({
  valid: z.boolean(),
  plan: z.enum(['go', 'pro']).nullable(),
});
export type LicenseValidateResult = z.infer<typeof LicenseValidateResultSchema>;
