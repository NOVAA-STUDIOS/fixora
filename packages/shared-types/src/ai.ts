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
 * Proceed Mode (P2.1) — Intelligent Editing. Unlike a repair, an edit is driven by a natural-language
 * instruction rather than a deterministic Finding, but it is held to the SAME verification pipeline
 * before anything is applied. These types are additive: the repair contract above is untouched.
 */

/** The category an editing instruction was classified into. `unknown` fails gracefully (no edit). */
export const EditIntentSchema = z.enum([
  'styling',
  'refactoring',
  'react',
  'typescript',
  'python',
  'documentation',
  'explanation',
  /**
   * A recognisable edit request that matches no specific category — "add error handling", "wrap this
   * in try/catch". The classifier is a keyword lexicon, and English is bigger than any lexicon, so a
   * plausible instruction must NOT be refused just because it missed a keyword. `general` is the
   * honest label for "this is an edit, we just have no specialised hint for it".
   */
  'general',
  /** Not an actionable instruction at all (empty, or no recognisable action). Refused, gracefully. */
  'unknown',
]);
export type EditIntent = z.infer<typeof EditIntentSchema>;

/** The model's structured edit output: a full replacement for the target scope, plus a summary. */
export const EditOutputSchema = z
  .object({
    /** The complete replacement source for the target scope only — not a diff, not the whole file. */
    editedCode: z.string().min(1),
    /** A one- or two-sentence summary of exactly what changed and why. */
    summary: z.string().min(1),
    confidence: z.number().min(0).max(1),
  })
  .strict();
export type EditOutput = z.infer<typeof EditOutputSchema>;

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
  /**
   * What the selected model can actually do, read from the provider's metadata.
   *
   * Carried on the config so the UI can disable an impossible action BEFORE the user takes it. The
   * failure this replaces: Repair looked available on every model, and incompatibility was
   * discovered only by pressing it and watching it fail.
   */
  capabilities: z
    .object({
      structuredOutput: z.boolean(),
      contextLength: z.number().nullable(),
      profiles: z.record(
        z.string(),
        z.object({
          supported: z.boolean(),
          reason: z.string().optional(),
          basis: z.string(),
        }),
      ),
    })
    .nullable()
    .default(null),
  /** A capable model to switch to, when the current one cannot do what the user wants. */
  suggestedModel: z
    .object({ id: z.string(), name: z.string(), free: z.boolean() })
    .nullable()
    .default(null),
});
export type AiConfig = z.infer<typeof AiConfigSchema>;

/** One entry of the live OpenRouter catalogue, as the renderer needs it for the model picker. */
export const AiModelOptionSchema = z.object({
  id: z.string(),
  name: z.string(),
  free: z.boolean(),
  codeCapable: z.boolean(),
  /** Provider-reported: can this model honour a JSON schema? Drives the Repair badge. */
  structuredOutput: z.boolean().default(false),
  contextLength: z.number().nullable().default(null),
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

/**
 * How much of the file a repair is allowed to change.
 *
 * The default is the smallest thing that works, and that is a safety property, not a limitation: the
 * splice range IS the blast radius, so widening it widens what a wrong patch can damage. Each step up
 * this ladder is therefore an explicit user choice, never an automatic escalation.
 *
 *  - `finding`       — the smallest validated patch: the enclosing scope of the selected finding.
 *  - `related-scope` — the SAME range, but other problems inside it are fixed by the same patch.
 *                      Minimality is preserved: the patch does not grow, it just does more within it.
 *  - `ai-file`       — the whole file. The largest possible blast radius, so it is advanced-only:
 *                      warned before running, never auto-run, and always previewed before Apply.
 */
export const RepairModeSchema = z.enum(['finding', 'related-scope', 'ai-file']);
export type RepairMode = z.infer<typeof RepairModeSchema>;

export const AiRunRequestSchema = z.object({
  profile: TaskProfileSchema,
  findingId: z.string().min(1),
  /** Absent means `finding` — the safe default, so an older caller keeps the old behaviour exactly. */
  mode: RepairModeSchema.optional(),
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

/**
 * The formatter gate result (Goals 4 & 9). `ran: false` means no formatter was available for the
 * language — an honestly-absent gate, not a pass. When it ran and failed, `message` is the formatter's
 * own diagnostic, shown to the user verbatim.
 */
export const FormatterGateSchema = z.object({
  ran: z.boolean(),
  ok: z.boolean(),
  formatter: z.string().optional(),
  message: z.string().optional(),
});
export type FormatterGate = z.infer<typeof FormatterGateSchema>;

/** Where the parser first choked, so the gate can say "Parser failed at line N" not just "does not parse". */
export const SyntaxErrorSchema = z.object({
  line: z.number().int().positive(),
  column: z.number().int().positive(),
  text: z.string(),
});
export type SyntaxErrorInfo = z.infer<typeof SyntaxErrorSchema>;

/** A finding the patch introduced — the evidence behind a failed verifier gate, with its location. */
export const NewFindingSchema = z.object({
  source: z.string(),
  ruleId: z.string(),
  line: z.number().int().nonnegative(),
  message: z.string(),
});
export type NewFinding = z.infer<typeof NewFindingSchema>;

export const VerificationReportSchema = z.object({
  /** Present whenever verification actually ran. See VerificationDiagnosticsSchema. */
  diagnostics: VerificationDiagnosticsSchema.optional(),
  verdict: VerdictSchema,
  targetResolved: z.boolean(),
  newFindingCount: z.number().int().nonnegative(),
  syntaxOk: z.boolean(),
  /** Where the parser failed, when it did — populated only when `syntaxOk` is false. */
  syntaxError: SyntaxErrorSchema.optional(),
  /** The formatter gate — present once verification has run it. */
  formatter: FormatterGateSchema.optional(),
  /** The findings the patch introduced (the verifier gate's evidence), with locations. */
  newFindings: z.array(NewFindingSchema).optional(),
  /** The checks that actually ran, e.g. ['syntax', 'eslint', 'tsc']. */
  ran: z.array(z.string()),
  note: z.string().optional(),
});
export type VerificationReport = z.infer<typeof VerificationReportSchema>;

/** One problem named in the repair summary, with why it was skipped when it was. */
export const RepairSummaryEntrySchema = z.object({
  ruleId: z.string(),
  line: z.number().int().nonnegative(),
  message: z.string(),
  /** Present only on `skipped` entries: the specific reason, never a generic one. */
  reason: z.string().optional(),
});
export type RepairSummaryEntry = z.infer<typeof RepairSummaryEntrySchema>;

/**
 * What a repair actually did, and — just as importantly — what it deliberately did not do.
 *
 * A patch that silently leaves problems untouched is indistinguishable from one that missed them.
 * Naming the skipped problems AND the reason for each is what makes a minimal patch legible as a
 * deliberate choice rather than an incomplete job.
 */
export const RepairSummarySchema = z.object({
  /** The finding the user asked to repair. */
  fixed: z.array(RepairSummaryEntrySchema),
  /** Further problems inside the same repair scope, fixed by the same patch. */
  related: z.array(RepairSummaryEntrySchema),
  /** Problems seen and deliberately left alone, each with its reason. */
  skipped: z.array(RepairSummaryEntrySchema),
});
export type RepairSummary = z.infer<typeof RepairSummarySchema>;

export const AiProposalSchema = z.discriminatedUnion('profile', [
  z.object({
    profile: z.literal('repair'),
    /** The id of this repair's row in local history — echoed back on apply to mark it applied. */
    historyId: z.string(),
    /** What the patch fixed, merged, and skipped. Optional so an older proposal still validates. */
    repairSummary: RepairSummarySchema.optional(),
    /** Which mode produced this patch, so the panel can state the scope it actually covers. */
    mode: RepairModeSchema.optional(),
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
  /** The file could not be READ before applying — deleted, renamed, locked, permission-denied. */
  'read-failed',
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
 * A classified provider failure, as the renderer receives it.
 *
 * Mirrors `ProviderFailure` in core-ai rather than importing it: shared-types is the IPC contract and
 * must not depend on the AI package. The duplication is checked by a test that walks the category and
 * action sets in both directions, so the two cannot drift silently.
 *
 * Everything here is safe to render. The diagnostic half of a failure — status code, request id,
 * latency, the provider's raw text — deliberately does NOT travel: it is written to the developer log
 * in the main process and never crosses the IPC boundary, because there is no UI that should show it
 * and every field that crosses is a field that can leak.
 */
/** The classification vocabulary, extracted so an attempt entry can reuse it. */
export const FailureCategorySchema = z.enum([
  'quota-exceeded',
  'rate-limited',
  'timeout',
  'invalid-api-key',
  'auth-failed',
  'provider-unavailable',
  'network-offline',
  'model-unavailable',
  'context-too-large',
  'invalid-response',
  'unknown-provider-error',
]);

export const AiFailureSchema = z.object({
  category: z.enum([
    'quota-exceeded',
    'rate-limited',
    'timeout',
    'invalid-api-key',
    'auth-failed',
    'provider-unavailable',
    'network-offline',
    'model-unavailable',
    'context-too-large',
    'invalid-response',
    'unknown-provider-error',
  ]),
  /** Whose problem this is. The card leads with it so a provider outage is never read as a Fixora bug. */
  layer: z.enum(['provider', 'configuration', 'engine']),
  /** Ordered, most useful first. Non-empty by construction — a failure always has a way forward. */
  actions: z
    .array(
      z.enum([
        'retry',
        'retry-later',
        'open-settings',
        'change-model',
        'check-credits',
        'check-connection',
      ]),
    )
    .min(1),
  /** Which provider was called, for the card's Provider row. */
  provider: z.string(),
  /** The model id that was asked. Shown as-is; it is the thing the user would change. */
  model: z.string(),
  /**
   * Every model tried before this failure, in order, when automatic failover walked a chain.
   *
   * Empty for a failure on the first candidate — the overwhelmingly common case — so the card stays
   * a plain status card and only grows the attempt list when there is genuinely something to show.
   * Carries the classification per attempt rather than a status code, for the same reason nothing
   * else on this schema does: it is rendered.
   */
  attempts: z
    .array(z.object({ model: z.string(), category: FailureCategorySchema }))
    .default([]),
});
export type AiFailure = z.infer<typeof AiFailureSchema>;
export type AiFailureCategory = AiFailure['category'];
export type AiRecoveryAction = AiFailure['actions'][number];

/**
 * The outcome of an AI run, as a value (TDD §9). `blocked` carries the gate matches so the UI can say
 * exactly which file and which rule stopped the send; `error` names the next step.
 */
export const AiRunResponseSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('ok'), proposal: AiProposalSchema }),
  z.object({ status: z.literal('blocked'), matches: z.array(GateMatchInfoSchema) }),
  z.object({
    status: z.literal('error'),
    // `internal_error` is Fixora's own fault, and it exists so an unexpected throw inside the
    // run can still travel as a typed VALUE. Without it the only way out was an exception,
    // which the router redacts to "Something went wrong handling that action." — the cause
    // reached neither the user nor the log.
    code: z.enum([
      'no_key',
      'provider_error',
      'schema_error',
      'not_found',
      'cancelled',
      // A run that exceeded its budget and was aborted. Distinct from `cancelled` (the user asked)
      // and from `provider_error` (the provider answered): nobody answered at all. Repair had no
      // timeout of any kind, so a stalled provider stream left the UI running forever — this code is
      // what makes "timed out" a reportable terminal state rather than an infinite spinner.
      'timeout',
      'internal_error',
    ]),
    message: z.string(),
    // Mirrors ProceedOutcome's error variant (P2.2.1): whether the same request could plausibly
    // succeed on a retry (quota reset, provider blip). Optional/absent for codes that were never
    // classified by the provider-failure pipeline (e.g. `no_key`, `not_found`), which are not
    // meaningfully "retryable" in the first place.
    retryable: z.boolean().optional(),
    /**
     * The classified failure, when one was produced.
     *
     * Optional because not every error path goes through the provider classifier — `cancelled` and
     * `not_found` are Fixora's own terminal states and have no provider to describe. The panel falls
     * back to the plain message for those, which is why `message` stays required.
     */
    failure: AiFailureSchema.optional(),
  }),
]);
export type AiRunResponse = z.infer<typeof AiRunResponseSchema>;

/** Streamed prose/token deltas for the active run (main → renderer). */
export const AiDeltaSchema = z.object({ text: z.string() });
export type AiDelta = z.infer<typeof AiDeltaSchema>;

/**
 * The phases a repair passes through, so "Running…" can say what it is actually doing.
 *
 * A repair is several seconds of work in at least four distinct systems (context assembly, the
 * provider, the verification worker, the formatter). Reporting all of that as one undifferentiated
 * "running" is what made a slow repair indistinguishable from a hung one — the user had no way to
 * tell progress from a stall, and neither did a bug report.
 */
export const AiRunStageSchema = z.enum([
  // Automatic provider failover is walking to the next model. A distinct stage because the panel
  // would otherwise sit on "Generating…" through several seconds of silent recovery, which reads as
  // a hang — the exact confusion the failover feature is supposed to remove.
  'failing-over',
  'preparing',
  'analyzing',
  'generating',
  'validating',
  'applying',
]);
export type AiRunStage = z.infer<typeof AiRunStageSchema>;

export const AiRunStateSchema = z.object({
  status: z.enum(['running', 'done', 'error', 'blocked']),
  message: z.string().optional(),
  /** Which phase the run is in. Optional so an older emitter (or a terminal state) can omit it. */
  stage: AiRunStageSchema.optional(),
});
export type AiRunState = z.infer<typeof AiRunStateSchema>;

/**
 * Proceed Mode (P2.1) — Intelligent Editing contracts. Additive: the repair/explain/test contracts
 * above are untouched. Placed after RepairTargetSchema/VerificationReportSchema/GateMatchInfoSchema
 * so every referenced schema is already defined.
 */

/** The request: a natural-language instruction plus the user's selection (where the cursor is). */
export const ProceedRunRequestSchema = z.object({
  instruction: z.string().min(1),
  file: z.string().min(1),
  selectionStartLine: z.number().int().positive(),
  selectionEndLine: z.number().int().positive().optional(),
});
export type ProceedRunRequest = z.infer<typeof ProceedRunRequestSchema>;

/** A verified Proceed edit, ready to preview + apply. Mirrors the repair proposal's diff-able shape. */
export const ProceedProposalSchema = z.object({
  intent: EditIntentSchema,
  /** The id of this edit's row in local history — echoed back on apply to mark it applied. */
  historyId: z.string(),
  editedCode: z.string(),
  /** The original text of the target scope — the left side of the diff view. */
  originalCode: z.string(),
  summary: z.string(),
  confidence: z.number().min(0).max(1),
  target: RepairTargetSchema,
  verification: VerificationReportSchema,
});
export type ProceedProposal = z.infer<typeof ProceedProposalSchema>;

/**
 * The terminal outcome of a Proceed run — exactly one, no generic errors. `rejected` carries the
 * verification report that refused the edit (safe apply: a failed edit is never applied).
 */
export const ProceedOutcomeSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('ok'), proposal: ProceedProposalSchema }),
  z.object({ status: z.literal('unknown-intent'), message: z.string() }),
  z.object({ status: z.literal('blocked'), matches: z.array(GateMatchInfoSchema) }),
  z.object({
    status: z.literal('rejected'),
    reason: z.string(),
    verification: VerificationReportSchema.optional(),
  }),
  z.object({
    status: z.literal('error'),
    /** The failing layer: quota | auth | model | network | provider | model-output | engine. */
    code: z.string(),
    message: z.string(),
    /** True when retrying the same request could plausibly succeed — drives the Retry affordance. */
    retryable: z.boolean().optional(),
  }),
]);
export type ProceedOutcome = z.infer<typeof ProceedOutcomeSchema>;
