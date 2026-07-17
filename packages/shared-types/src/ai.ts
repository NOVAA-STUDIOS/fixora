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

/** A curated set of OpenRouter model ids the beta offers. Others work — this is the UI shortlist. */
export const AI_MODEL_OPTIONS = [
  'anthropic/claude-3.5-sonnet',
  'openai/gpt-4o',
  'openai/gpt-4o-mini',
  'google/gemini-2.0-flash-001',
] as const;
export const DEFAULT_AI_MODEL = 'anthropic/claude-3.5-sonnet';

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

export const AiProposalSchema = z.discriminatedUnion('profile', [
  z.object({
    profile: z.literal('repair'),
    repairedCode: z.string(),
    rationale: z.string(),
    confidence: z.number().min(0).max(1),
    target: RepairTargetSchema,
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
