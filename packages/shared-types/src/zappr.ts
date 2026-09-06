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

/** A Jarvis-style command Zappr can carry out directly, detected from the prompt without an AI call. */
export const ZapprActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('open_settings') }),
  z.object({ type: z.literal('set_theme'), theme: z.enum(['dark', 'light']) }),
  z.object({
    type: z.literal('set_provider'),
    providerId: z.string(),
    apiKey: z.string().optional(),
    model: z.string().optional(),
  }),
  z.object({ type: z.literal('create_shortcut'), keys: z.string(), commandId: z.string() }),
  z.object({ type: z.literal('create_file'), path: z.string(), content: z.string().optional() }),
  z.object({ type: z.literal('open_folder') }),
  z.object({ type: z.literal('toggle_panel') }),
  z.object({ type: z.literal('run_analysis') }),
  z.object({ type: z.literal('none') }),
]);
export type ZapprAction = z.infer<typeof ZapprActionSchema>;
