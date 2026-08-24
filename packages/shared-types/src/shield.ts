import { z } from 'zod';

/**
 * Code Shield — the "senior engineer looking over your shoulder" report for ONE file.
 *
 * Every number and every issue here is derived from real analyzer output (ESLint, tsc, and the rest
 * of the pipeline `analysis-service.ts` already runs). Nothing in this shape may ever be invented:
 * a score with no findings behind it, or advice not tied to an actual rule, would make the whole
 * feature untrustworthy — and a trust surface that lies once is worth less than no surface at all.
 */

export const ShieldCategorySchema = z.enum([
  'security',
  'performance',
  'bugs',
  'style',
  'tests',
]);
export type ShieldCategory = z.infer<typeof ShieldCategorySchema>;

export const ShieldSeveritySchema = z.enum(['critical', 'warning']);
export type ShieldSeverity = z.infer<typeof ShieldSeveritySchema>;

/** One real finding, restated in the Shield's vocabulary. `id` is the analyzer's own finding id, so
 *  an Auto-Fix can hand it straight back to the repair pipeline. */
export const ShieldIssueSchema = z.object({
  id: z.string().min(1),
  severity: ShieldSeveritySchema,
  category: ShieldCategorySchema,
  message: z.string(),
  file: z.string(),
  line: z.number().int().positive(),
  /** One sentence, specific to THIS rule — never generic filler. See `shield-service.ts`. */
  seniorAdvice: z.string(),
  /** True only when the analyzer itself authored a deterministic autofix for this finding. */
  fixAvailable: z.boolean(),
});
export type ShieldIssue = z.infer<typeof ShieldIssueSchema>;

/** A check that ran. `passed` says whether it passed — the array always lists every check that
 *  ran, not only the ones that passed, so a deduction (e.g. no tests) is explainable, not silent. */
export const ShieldCheckSchema = z.object({
  name: z.string(),
  passed: z.boolean(),
  message: z.string(),
});
export type ShieldCheck = z.infer<typeof ShieldCheckSchema>;

export const PrReadinessSchema = z.enum(['ready', 'needs-work', 'not-ready']);
export type PrReadiness = z.infer<typeof PrReadinessSchema>;

export const CodeShieldReportSchema = z.object({
  /** Null whenever `error` is set — a file that was not analyzable, timed out, or failed has NO
   *  score, never a 0 or a value computed from partial data. */
  score: z.number().int().min(0).max(100).nullable(),
  critical: z.array(ShieldIssueSchema),
  warnings: z.array(ShieldIssueSchema),
  passed: z.array(ShieldCheckSchema),
  prReadiness: PrReadinessSchema,
  analyzedAt: z.number(),
  /** The file this report is about — the panel must never show one file's score against another. */
  file: z.string(),
  /** Set when analysis could not complete, or the file cannot be analyzed at all (wrong type,
   *  binary, not found, gitignored, secret-denied). The UI shows an error state and no score. */
  error: z.string().nullable().default(null),
});
export type CodeShieldReport = z.infer<typeof CodeShieldReportSchema>;

/**
 * How much the Shield reports. This is the ONLY knob that changes the score, and it changes it by
 * changing which real findings are counted — never by scaling the number afterwards.
 */
export const ShieldSensitivitySchema = z.enum(['strict', 'balanced', 'relaxed']);
export type ShieldSensitivity = z.infer<typeof ShieldSensitivitySchema>;

export const ShieldSettingsSchema = z.object({
  enabled: z.boolean(),
  sensitivity: ShieldSensitivitySchema,
});
export type ShieldSettings = z.infer<typeof ShieldSettingsSchema>;
