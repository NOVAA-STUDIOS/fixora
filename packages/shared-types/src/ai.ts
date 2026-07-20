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
  /**
   * Set when the stored model was no longer in OpenRouter's catalogue and was migrated for the user.
   * Carries the id we moved *away from*, so the UI can explain the change rather than silently
   * swapping the model out from under someone.
   */
  migratedFrom: z.string().nullable().default(null),
});
export type AiConfig = z.infer<typeof AiConfigSchema>;

/** One entry of the live OpenRouter catalogue, as the renderer needs it for the model picker. */
export const AiModelOptionSchema = z.object({
  id: z.string(),
  name: z.string(),
  free: z.boolean(),
  codeCapable: z.boolean(),
});
export type AiModelOption = z.infer<typeof AiModelOptionSchema>;

/**
 * Where the model list came from. The picker says so, because "these are the models that exist" and
 * "these are the models that existed when we last had a network" are different promises.
 */
export const ModelCatalogueSourceSchema = z.enum(['live', 'cache', 'unavailable']);
export type ModelCatalogueSource = z.infer<typeof ModelCatalogueSourceSchema>;

export const AiModelListSchema = z.object({
  models: z.array(AiModelOptionSchema),
  source: ModelCatalogueSourceSchema,
  /** Present when the catalogue could not be reached, or has nothing free to offer. */
  notice: z.string().nullable().default(null),
});
export type AiModelList = z.infer<typeof AiModelListSchema>;

/**
 * No model id is compiled into the product any more.
 *
 * A baked-in list goes stale on OpenRouter's schedule, not ours: slugs are retired as providers
 * rotate their line-ups, and a retired slug answers with a bare 404. That is exactly how the beta
 * broke — every shipped id had been retired. The live catalogue is now the only authority on what
 * exists, and the compiled-in *preferences* (see `PREFERRED_FREE_CODE_MODELS` in core-ai) are a
 * wish-list resolved against it, never used as ids in their own right.
 *
 * This sentinel means "no model resolved yet" — a fresh install before the first catalogue fetch, or
 * an install that has never had a reachable network. It is never sent to the provider.
 */
export const UNRESOLVED_MODEL = '';

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
/**
 * Why a verdict came out the way it did, in full.
 *
 * The report says *what* was decided; this says *how*. Without it a `regression` verdict is an
 * assertion the user has to take on faith — they can see "introduces 2 new problems" but not which
 * two, or why the comparison thought they were new. Signature comparison is the whole mechanism, so
 * the signatures are the evidence.
 *
 * Optional because it is diagnostic, not contractual: a report without it is still a valid report.
 */
export const VerificationDiagnosticsSchema = z.object({
  /** The signature of the finding being repaired. */
  targetSignature: z.string(),
  /** Signatures present in the file before the patch (the baseline). */
  originalSignatures: z.array(z.string()),
  /** Signatures present in the patched overlay. */
  patchedSignatures: z.array(z.string()),
  /** In the patched set, absent from the baseline, and not the target — these force `regression`. */
  newSignatures: z.array(z.string()),
  /** The severity of the finding being repaired. Recorded to prove it never enters the decision. */
  targetSeverity: z.string(),
  /** Analyzers that produced the baseline vs the patched set — a mismatch here explains phantom
   *  regressions, where the overlay ran a different toolset than the workspace analysis did. */
  originalSources: z.array(z.string()),
  patchedSources: z.array(z.string()),
});
export type VerificationDiagnostics = z.infer<typeof VerificationDiagnosticsSchema>;

export const VerificationReportSchema = z.object({
  /** Present whenever verification actually ran. See VerificationDiagnosticsSchema. */
  diagnostics: VerificationDiagnosticsSchema.optional(),
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

/**
 * The outcome of an apply attempt — as a *value*, not an exception.
 *
 * `ai:applyRepair` used to throw when the target range no longer matched, which is an expected,
 * user-actionable condition rather than a bug. The router redacts thrown errors on purpose
 * ("the message is redacted before it crosses the boundary"), so the one sentence that explained
 * the failure — "the file changed since this repair was proposed" — was replaced with "Something
 * went wrong handling that action" before it reached the UI. The redaction is right; using an
 * exception for a normal outcome was not.
 *
 * So the outcome is contract data now: schema-validated, never redacted, and carrying the evidence
 * needed to tell the three failure modes apart without guessing.
 */
export const ApplyFailureReasonSchema = z.enum([
  /** The file on disk no longer matches what the repair was computed against. */
  'stale-range',
  /** The requested line range does not exist in the current file (file shrank, or bad range). */
  'range-out-of-bounds',
  /** No workspace is open, so there is nothing to write to. */
  'no-workspace',
  /** The write itself failed (permissions, disk, path guard). */
  'write-failed',
]);
export type ApplyFailureReason = z.infer<typeof ApplyFailureReasonSchema>;

/** What the stale-range guard actually compared. Lengths and hashes, plus a bounded excerpt. */
export const StaleRangeCheckSchema = z.object({
  passed: z.boolean(),
  startLine: z.number().int(),
  endLine: z.number().int(),
  fileLineCount: z.number().int(),
  expectedLength: z.number().int(),
  actualLength: z.number().int(),
  expectedHash: z.string(),
  actualHash: z.string(),
  /** First line number where the two differ, 1-based within the range. Null when identical. */
  firstDifferingLine: z.number().int().nullable(),
  /** Bounded excerpts around the first difference — the user's own code, on the user's own screen. */
  expectedExcerpt: z.string(),
  actualExcerpt: z.string(),
});
export type StaleRangeCheck = z.infer<typeof StaleRangeCheckSchema>;

export const ApplyOutcomeSchema = z.discriminatedUnion('applied', [
  z.object({
    applied: z.literal(true),
    staleRangeCheck: StaleRangeCheckSchema,
    bytesWritten: z.number().int(),
  }),
  z.object({
    applied: z.literal(false),
    reason: ApplyFailureReasonSchema,
    /** Plain English, names the next step, and is never redacted because it is not an exception. */
    message: z.string().min(1),
    staleRangeCheck: StaleRangeCheckSchema.nullable(),
  }),
]);
export type ApplyOutcome = z.infer<typeof ApplyOutcomeSchema>;

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
