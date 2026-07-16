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
