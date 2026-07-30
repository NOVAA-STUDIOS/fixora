import { z } from 'zod';

/**
 * Anonymous repair telemetry, for engineering diagnostics only.
 *
 * ## The privacy design, which is the whole point
 *
 * This schema is the enforcement mechanism, not a promise in a doc comment. It is `.strict()` and
 * contains **no field capable of holding source code** — every entry is an enum, a count, or a
 * timestamp. Prompts, model responses, patches, file paths and identifiers have nowhere to go, so a
 * future edit cannot casually start recording them: it would have to add a field here first, in the
 * contract layer, where the addition is visible in review.
 *
 * Sizes are recorded as CHARACTER COUNTS. "How big was the prompt" is a real performance question;
 * "what was in it" is not one this store is allowed to answer.
 *
 * Distinct from `repair-trace.ts`, which deliberately DOES capture source for a failed repair. That
 * one writes a single local file on failure for a bug report; this one is a rolling dataset. Only the
 * anonymous one accumulates.
 */

/** What ultimately happened to a repair attempt. Exactly one, always. */
export const RepairOutcomeSchema = z.enum([
  'success',
  'rejected',
  'manual-only',
  'timeout',
  'cancelled',
  'failed',
]);
export type RepairOutcome = z.infer<typeof RepairOutcomeSchema>;

/** Why it did not succeed. Absent on success. */
export const RepairFailureReasonSchema = z.enum([
  'parser',
  'verifier',
  'regression',
  'timeout',
  'ai-invalid-response',
  'schema',
  'manual-only',
  'unsupported',
  'cancelled',
  'unknown',
]);
export type RepairFailureReason = z.infer<typeof RepairFailureReasonSchema>;

/** A validator's result. `not-run` is first-class — it means no such check exists for this language. */
export const ValidationResultSchema = z.enum(['pass', 'fail', 'not-run']);
export type ValidationResult = z.infer<typeof ValidationResultSchema>;

/**
 * One repair attempt, reduced to what can be counted.
 *
 * `.strict()` on purpose: an unknown key is rejected rather than stored, so a caller that tries to
 * attach something richer fails loudly instead of quietly leaking it into the dataset.
 */
export const RepairMetricSchema = z
  .object({
    at: z.number().int(),
    durationMs: z.number().int().nonnegative(),
    /** The analysis language, or `mixed` when a run spans more than one. Never a path. */
    language: z.string(),
    mode: z.string(),
    provider: z.string(),
    model: z.string(),
    /** The rule that triggered the repair — an identifier from a fixed tool vocabulary, not content. */
    ruleId: z.string(),
    outcome: RepairOutcomeSchema,
    failureReason: RepairFailureReasonSchema.optional(),
    validation: z.object({
      syntax: ValidationResultSchema,
      lint: ValidationResultSchema,
      type: ValidationResultSchema,
      regression: ValidationResultSchema,
    }),
    /** Sizes in characters. How big, never what. */
    sizes: z.object({
      promptChars: z.number().int().nonnegative(),
      responseChars: z.number().int().nonnegative(),
      patchChars: z.number().int().nonnegative(),
      diffChars: z.number().int().nonnegative(),
      contextChars: z.number().int().nonnegative(),
    }),
  })
  .strict();
export type RepairMetric = z.infer<typeof RepairMetricSchema>;

/**
 * How many records are retained before the oldest roll off.
 *
 * A bounded ring, not a growing log: this is a diagnostic sample, and an unbounded one would become a
 * disk-space and startup cost for a feature most users never open.
 */
export const REPAIR_METRICS_LIMIT = 5000;
