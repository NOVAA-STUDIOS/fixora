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

/** The foreground process name changed (polled — node-pty has no change event for this). */
export const TerminalTitleSchema = z.object({ id: z.string().min(1), processName: z.string() });
export type TerminalTitle = z.infer<typeof TerminalTitleSchema>;

/** The background index found this many analyzable files — large enough to be worth mentioning. */
export const WorkspaceLargeProjectSchema = z.object({ fileCount: z.number().int().nonnegative() });
export type WorkspaceLargeProject = z.infer<typeof WorkspaceLargeProjectSchema>;

/** The raw `fixora://auth/callback#...` URL the OS handed back after system-browser OAuth. */
export const AuthCallbackSchema = z.object({ url: z.string() });
export type AuthCallback = z.infer<typeof AuthCallbackSchema>;

/** Watch Mode's status pushes — a file changed on disk, its re-analysis started, or it finished. */
export const AnalysisWatchEventSchema = z.object({
  file: z.string(),
  status: z.enum(['changed', 'reanalyzing', 'done']),
});
export type AnalysisWatchEvent = z.infer<typeof AnalysisWatchEventSchema>;

/** Background indexing progress — how many files indexed so far. No total/percent: a single-pass
 * walk doesn't know the file count until it finishes. */
export const WorkspaceIndexProgressSchema = z.object({ indexed: z.number().int().nonnegative() });
export type WorkspaceIndexProgress = z.infer<typeof WorkspaceIndexProgressSchema>;

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
  'terminal:title': TerminalTitleSchema,
  'analysis:watchEvent': AnalysisWatchEventSchema,
  'workspace:largeProject': WorkspaceLargeProjectSchema,
  'workspace:indexProgress': WorkspaceIndexProgressSchema,
  'app:ready': z.object({}),
  'auth:callback': AuthCallbackSchema,
  'license:revalidateNeeded': z.object({}),
  'license:planRevoked': z.object({}),
} as const satisfies Record<EventChannel, z.ZodType>;

export type EventContracts = typeof eventContracts;
export type EventPayloadOf<E extends EventChannel> = z.infer<EventContracts[E]>;
