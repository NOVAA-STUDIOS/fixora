import { z } from 'zod';

import { AiDeltaSchema, AiRunStateSchema } from './ai.js';
import { AnalysisStateSchema, FindingSchema } from './analysis.js';
import type { EventChannel } from './channels.js';
import { FilesChangedSchema } from './workspace.js';

/**
 * The main → renderer event contracts (push). The counterpart to `contracts` in ipc.ts, for the
 * one direction that is unsolicited: main tells the renderer something changed.
 *
 * Same drift-proofing as the request registry — `satisfies Record<EventChannel, …>` makes a
 * declared event without a schema, or a schema without a declared channel, a compile error. The
 * emitter in main validates the payload against this schema before sending, so the renderer's
 * subscription always receives a known shape; the preload stays zod-free and just forwards.
 */

export const WindowMaximizedChangedSchema = z.object({
  isMaximized: z.boolean(),
});
export type WindowMaximizedChanged = z.infer<typeof WindowMaximizedChangedSchema>;

/** A batch of findings the analysis produced, streamed to the panel as they arrive (M3). */
export const FindingsAddedSchema = z.object({ findings: z.array(FindingSchema) });
export type FindingsAdded = z.infer<typeof FindingsAddedSchema>;

/** A newer build exists and has started downloading in the background. */
export const UpdateAvailableSchema = z.object({ version: z.string() });
export type UpdateAvailable = z.infer<typeof UpdateAvailableSchema>;

/** The download finished; `update:install` will quit and relaunch on it. */
export const UpdateDownloadedSchema = z.object({ version: z.string() });
export type UpdateDownloaded = z.infer<typeof UpdateDownloadedSchema>;

/** The check or download failed — never fatal to the app, but worth the renderer knowing. */
export const UpdateErrorSchema = z.object({ message: z.string() });
export type UpdateError = z.infer<typeof UpdateErrorSchema>;

/** A chunk of PTY output, keyed by the session id `terminal:create` was called with. */
export const TerminalDataSchema = z.object({ id: z.string().min(1), data: z.string() });
export type TerminalData = z.infer<typeof TerminalDataSchema>;

/** The shell process exited — the renderer stops writing to this session and may tear it down. */
export const TerminalExitSchema = z.object({
  id: z.string().min(1),
  exitCode: z.number().int(),
});
export type TerminalExit = z.infer<typeof TerminalExitSchema>;

export const eventContracts = {
  'window:maximizedChanged': WindowMaximizedChangedSchema,
  'workspace:filesChanged': FilesChangedSchema,
  'analysis:findingsAdded': FindingsAddedSchema,
  'analysis:state': AnalysisStateSchema,
  'ai:delta': AiDeltaSchema,
  'ai:runState': AiRunStateSchema,
  'update:available': UpdateAvailableSchema,
  'update:downloaded': UpdateDownloadedSchema,
  'update:error': UpdateErrorSchema,
  'terminal:data': TerminalDataSchema,
  'terminal:exit': TerminalExitSchema,
} as const satisfies Record<EventChannel, z.ZodType>;

export type EventContracts = typeof eventContracts;
export type EventPayloadOf<E extends EventChannel> = z.infer<EventContracts[E]>;
