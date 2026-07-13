import { z } from 'zod';

/**
 * Errors are **values**, not exceptions (TDD §9). Exceptions are for bugs.
 *
 * The rule that makes this worth the ceremony: **every error a human sees names the next
 * step.** "Quota exceeded" is a dead end; "you've used your 2M monthly tokens — upgrade, or
 * add your own API key in Settings → AI" is a product. That is why `action` is part of the
 * schema and not part of the copy: a UI cannot forget to render a field that the contract
 * requires the producer to supply.
 *
 * M0 defines the envelope and the codes the shell can actually raise today. Codes belonging
 * to systems that do not exist yet (patch, verification, provider) arrive with those systems;
 * inventing them now would be a placeholder, which Standards §2 forbids.
 */

export const ErrorActionSchema = z.object({
  /** What the user can do about it. `none` is allowed, but it must be chosen, not defaulted. */
  type: z.enum(['none', 'retry', 'open_settings', 'upgrade_or_byok', 'open_url']),
  label: z.string().min(1),
  url: z.url().optional(),
});
export type ErrorAction = z.infer<typeof ErrorActionSchema>;

export const FixoraErrorCodeSchema = z.enum([
  /** An IPC payload failed schema validation. Always a bug (in us) or an attack (from a compromised renderer). */
  'IPC_CONTRACT_VIOLATION',
  /** No handler is registered for the channel. */
  'IPC_UNKNOWN_CHANNEL',
  /** A handler threw. The message is redacted before it crosses the boundary. */
  'IPC_HANDLER_FAILED',
  /** A path resolved outside the open workspace root. Logged as a SECURITY EVENT (Security §3). */
  'PATH_OUTSIDE_WORKSPACE',
]);
export type FixoraErrorCode = z.infer<typeof FixoraErrorCodeSchema>;

export const FixoraErrorSchema = z.object({
  code: FixoraErrorCodeSchema,
  /** Shown to a human. Must be plain English, and must not contain source code or absolute paths. */
  message: z.string().min(1),
  action: ErrorActionSchema,
  /** Generated in the renderer, propagated renderer → main → API → provider (API §4). */
  requestId: z.string().min(1),
});
export type FixoraError = z.infer<typeof FixoraErrorSchema>;

/**
 * The Result shape carried across every boundary. A handler that wants to fail returns a
 * failure; it does not throw, because a thrown error loses its type at the process boundary
 * and arrives as a string that no UI can act on.
 */
export type Result<T> = { ok: true; value: T } | { ok: false; error: FixoraError };

export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

export function err<T = never>(error: FixoraError): Result<T> {
  return { ok: false, error };
}

export const ResultSchema = <T extends z.ZodType>(value: T) =>
  z.discriminatedUnion('ok', [
    z.object({ ok: z.literal(true), value }),
    z.object({ ok: z.literal(false), error: FixoraErrorSchema }),
  ]);
