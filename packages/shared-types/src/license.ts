import { z } from 'zod';

/**
 * Licensing. Free tier is rate-limited; GO/PRO are Gumroad-hosted products the app validates
 * online against Gumroad's public license-verify endpoint (no server of our own). Supersedes
 * the earlier offline Ed25519 design — that model assumed a signed, self-verifying token; this one
 * assumes a purchased key checked against Gumroad at activation time.
 */

export const PlanSchema = z.enum(['free', 'go', 'pro']);
export type Plan = z.infer<typeof PlanSchema>;

export const LicenseValidateResultSchema = z.object({
  valid: z.boolean(),
  plan: z.enum(['go', 'pro']).nullable(),
});
export type LicenseValidateResult = z.infer<typeof LicenseValidateResultSchema>;
