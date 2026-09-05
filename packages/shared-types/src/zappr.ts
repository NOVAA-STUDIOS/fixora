import { z } from 'zod';

/**
 * Zappr: a freeform-prompt coding agent (distinct from the finding-grounded repair pipeline).
 * The model proposes a plan of file operations; each step is executed and reported individually.
 */
export const ZapprStepTypeSchema = z.enum(['create', 'edit', 'delete']);
export type ZapprStepType = z.infer<typeof ZapprStepTypeSchema>;

export const ZapprStepSchema = z.object({
  type: ZapprStepTypeSchema,
  filePath: z.string().min(1),
  description: z.string(),
  /** Full file content for create/edit. Absent for delete. */
  content: z.string().optional(),
});
export type ZapprStep = z.infer<typeof ZapprStepSchema>;

export const ZapprPlanSchema = z.object({
  steps: z.array(ZapprStepSchema),
  summary: z.string(),
});
export type ZapprPlan = z.infer<typeof ZapprPlanSchema>;
