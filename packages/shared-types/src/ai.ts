import { z } from 'zod';

/**
 * The AI task vocabulary shared across the boundary (AI-Pipeline §5). The renderer asks main to run
 * one of these against a grounded finding; `core-ai` builds the request and parses the result. It
 * lives here, in the contract layer, so neither the engine nor the renderer owns the shape.
 *
 * The beta ships three profiles. `repair` and `test` produce schema-constrained structured output;
 * `explain` streams prose. Every one is grounded on a deterministic `Finding` (ADR-002) — the model
 * never invents what to work on.
 */
export const TaskProfileSchema = z.enum(['repair', 'explain', 'test']);
export type TaskProfile = z.infer<typeof TaskProfileSchema>;

/** The model's structured repair output: a full replacement for the target symbol, plus reasoning. */
export const RepairOutputSchema = z
  .object({
    repairedCode: z.string().min(1),
    rationale: z.string().min(1),
    confidence: z.number().min(0).max(1),
  })
  .strict();
export type RepairOutput = z.infer<typeof RepairOutputSchema>;

/** The model's structured test output. Verified before it is ever shown (AI-Pipeline §5). */
export const TestOutputSchema = z
  .object({
    framework: z.string().min(1),
    testCode: z.string().min(1),
    rationale: z.string().min(1),
  })
  .strict();
export type TestOutput = z.infer<typeof TestOutputSchema>;

/**
 * BYOK config the *renderer* is allowed to see. It carries whether a key is set, the chosen model,
 * and a non-sensitive hint (last few chars) — but **never the key itself**. The key lives encrypted
 * in the OS keychain and is read only in the main process, right before a provider call.
 */
export const AiConfigSchema = z.object({
  configured: z.boolean(),
  model: z.string(),
  keyHint: z.string().nullable(),
});
export type AiConfig = z.infer<typeof AiConfigSchema>;

/**
 * A curated set of OpenRouter model ids the beta offers. Others work — this is the UI shortlist.
 *
 * **These ids expire.** OpenRouter retires slugs as providers rotate their line-ups, and it answers a
 * request for a retired slug with **404**, not with a descriptive error. That is exactly how the beta
 * broke: every id in the previous list (`anthropic/claude-3.5-sonnet`, `openai/gpt-4o`,
 * `openai/gpt-4o-mini`, `google/gemini-2.0-flash-001`) had been retired, so every AI action 404'd.
 *
 * Verified against https://openrouter.ai/api/v1/models on 2026-07-18. Before a release, re-check them
 * against that endpoint — a hardcoded list is a maintenance debt we are accepting knowingly for the
 * beta, not something that stays correct on its own. Fetching the live list is the v1.1 fix.
 */
export const AI_MODEL_OPTIONS = [
  'anthropic/claude-sonnet-5',
  'anthropic/claude-opus-4.8',
  'openai/gpt-5.6-terra',
  'google/gemini-3.5-flash',
] as const;

/** Balanced default for code work. Users on a metered key can drop to a cheaper id in Settings. */
export const DEFAULT_AI_MODEL = 'anthropic/claude-sonnet-5';

/**
 * Model ids we shipped that OpenRouter has since retired. A stored preference outlives an upgrade, so
 * without this an existing install keeps its dead id and keeps 404-ing no matter what the new default
 * is — the upgrade would appear to fix nothing.
 *
 * Only ids *we* shipped belong here. A model the user chose themselves is their call: we do not
 * second-guess an id just because it is missing from our shortlist.
 */
export const RETIRED_AI_MODELS: readonly string[] = [
  'anthropic/claude-3.5-sonnet',
  'openai/gpt-4o',
  'openai/gpt-4o-mini',
  'google/gemini-2.0-flash-001',
];

/** The model to actually use for a stored preference: the stored one, unless we retired it. */
export function resolveModelId(stored: string): string {
  return RETIRED_AI_MODELS.includes(stored) ? DEFAULT_AI_MODEL : stored;
}

export const AiRunRequestSchema = z.object({
  profile: TaskProfileSchema,
  findingId: z.string().min(1),
});
export type AiRunRequest = z.infer<typeof AiRunRequestSchema>;

/** Where in the file a repair applies — carried through so Phase D can diff + apply by range. */
export const RepairTargetSchema = z.object({
  file: z.string(),
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive(),
  symbolName: z.string().nullable(),
});

/**
 * The verification verdict (ADR-003). This is the claim that justifies leaving the editor:
 *   - `verified`   — the target finding is resolved and no new problem was introduced.
 *   - `regression` — the fix broke syntax or introduced a finding that was not there before.
 *   - `unresolved` — nothing broke, but the finding is still present (the fix didn't take).
 *   - `skipped`    — verification could not run (no analyzer available for this file).
 */
export const VerdictSchema = z.enum(['verified', 'regression', 'unresolved', 'skipped']);
export type Verdict = z.infer<typeof VerdictSchema>;

/**
 * The verification report. Tiered and honest (ADR-003): we say exactly which checks ran, so the UI can
 * read "verified against eslint, tsc, syntax" rather than overclaiming. `newFindingCount` is the number
 * of problems the patched file has that the original did not.
 */
export const VerificationReportSchema = z.object({
  verdict: VerdictSchema,
  targetResolved: z.boolean(),
  newFindingCount: z.number().int().nonnegative(),
  syntaxOk: z.boolean(),
  /** The checks that actually ran, e.g. ['syntax', 'eslint', 'tsc']. */
  ran: z.array(z.string()),
  note: z.string().optional(),
});
export type VerificationReport = z.infer<typeof VerificationReportSchema>;

export const AiProposalSchema = z.discriminatedUnion('profile', [
  z.object({
    profile: z.literal('repair'),
    /** The id of this repair's row in local history — echoed back on apply to mark it applied. */
    historyId: z.string(),
    repairedCode: z.string(),
    /** The original text of the target symbol — the left side of the diff view. */
    originalCode: z.string(),
    rationale: z.string(),
    confidence: z.number().min(0).max(1),
    target: RepairTargetSchema,
    verification: VerificationReportSchema,
  }),
  z.object({ profile: z.literal('explain'), explanation: z.string() }),
  z.object({
    profile: z.literal('test'),
    framework: z.string(),
    testCode: z.string(),
    rationale: z.string(),
  }),
]);
export type AiProposal = z.infer<typeof AiProposalSchema>;

/** Apply a verified repair: replace the target line range in the file with the repaired code. */
export const ApplyRepairRequestSchema = z.object({
  file: z.string().min(1),
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive(),
  code: z.string(),
  /**
   * The exact text the target range held when the repair was proposed. Main refuses to apply if the
   * file has changed since (the range would be stale) — a repair is never spliced into code it was
   * not computed against.
   */
  expectedOriginal: z.string(),
  /** The history row to mark as applied (from the repair proposal). */
  historyId: z.string().optional(),
});
export type ApplyRepairRequest = z.infer<typeof ApplyRepairRequestSchema>;

/** One recorded repair in the local, private audit trail (Beta Phase E). */
export const RepairHistoryEntrySchema = z.object({
  id: z.string(),
  findingId: z.string(),
  file: z.string(),
  symbolName: z.string().nullable(),
  ruleId: z.string(),
  source: z.string(),
  verdict: VerdictSchema,
  applied: z.boolean(),
  rationale: z.string(),
  originalCode: z.string(),
  repairedCode: z.string(),
  model: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive(),
  createdAt: z.number(),
  appliedAt: z.number().nullable(),
});
export type RepairHistoryEntry = z.infer<typeof RepairHistoryEntrySchema>;

/** One reason the gate refused a send — which part, which rule — with no secret attached. */
export const GateMatchInfoSchema = z.object({
  label: z.string(),
  rule: z.string(),
  kind: z.enum(['path', 'content', 'entropy']),
});
export type GateMatchInfo = z.infer<typeof GateMatchInfoSchema>;

/**
 * The outcome of an AI run, as a value (TDD §9). `blocked` carries the gate matches so the UI can say
 * exactly which file and which rule stopped the send; `error` names the next step.
 */
export const AiRunResponseSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('ok'), proposal: AiProposalSchema }),
  z.object({ status: z.literal('blocked'), matches: z.array(GateMatchInfoSchema) }),
  z.object({
    status: z.literal('error'),
    code: z.enum(['no_key', 'provider_error', 'schema_error', 'not_found', 'cancelled']),
    message: z.string(),
  }),
]);
export type AiRunResponse = z.infer<typeof AiRunResponseSchema>;

/** Streamed prose/token deltas for the active run (main → renderer). */
export const AiDeltaSchema = z.object({ text: z.string() });
export type AiDelta = z.infer<typeof AiDeltaSchema>;

export const AiRunStateSchema = z.object({
  status: z.enum(['running', 'done', 'error', 'blocked']),
  message: z.string().optional(),
});
export type AiRunState = z.infer<typeof AiRunStateSchema>;
