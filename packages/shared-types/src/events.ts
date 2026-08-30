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
export const UpdateAvailableSchema = z.object({
  version: z.string(),
  releaseNotes: z.string().optional(),
});
export type UpdateAvailable = z.infer<typeof UpdateAvailableSchema>;

/** Download progress for the update already in flight. */
export const UpdateProgressSchema = z.object({ percent: z.number().min(0).max(100) });
export type UpdateProgress = z.infer<typeof UpdateProgressSchema>;

/** The download finished; `update:install` will quit and relaunch on it. */
export const UpdateDownloadedSchema = z.object({ version: z.string() });
export type UpdateDownloaded = z.infer<typeof UpdateDownloadedSchema>;

/** The check or download failed — never fatal to the app, but worth the renderer knowing. */
export const UpdateErrorSchema = z.object({ message: z.string() });
export type UpdateError = z.infer<typeof UpdateErrorSchema>;

/** Fired once, after `app:ready`, only when the version on disk from the previous launch differs
 *  from this one — i.e. an update just took effect. Never fires on a fresh install (no previous
 *  version recorded yet). */
export const AppJustUpdatedSchema = z.object({
  previousVersion: z.string(),
  currentVersion: z.string(),
});
export type AppJustUpdated = z.infer<typeof AppJustUpdatedSchema>;

/** The port scanner (preview-service.ts) found a listening localhost dev server. */
export const PreviewServerDetectedSchema = z.object({
  port: z.number().int(),
  url: z.string(),
  framework: z.string(),
});
export type PreviewServerDetected = z.infer<typeof PreviewServerDetectedSchema>;

/** The embedded preview's page title changed (`page-title-updated`). */
export const PreviewTitleChangedSchema = z.object({ title: z.string() });
export type PreviewTitleChanged = z.infer<typeof PreviewTitleChangedSchema>;

/** The embedded preview started or finished loading (`did-start-loading`/`did-stop-loading`). */
export const PreviewLoadingChangedSchema = z.object({ loading: z.boolean() });
export type PreviewLoadingChanged = z.infer<typeof PreviewLoadingChangedSchema>;

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
export const WorkspaceLargeProjectSchema = z.object({
  fileCount: z.number().int().nonnegative(),
  rootPath: z.string(),
});
export type WorkspaceLargeProject = z.infer<typeof WorkspaceLargeProjectSchema>;

/** The raw `fixora://auth/callback#...` URL the OS handed back after system-browser OAuth. Dead
 *  since PKCE + loopback replaced this path — kept only as long as the channel itself is. */
export const AuthCallbackSchema = z.object({ url: z.string() });
export type AuthCallback = z.infer<typeof AuthCallbackSchema>;

/**
 * The outcome of a PKCE + loopback OAuth round trip (RFC 8252). `session` carries exactly what
 * `supabase.auth.setSession` needs — never the authorization code, the state nonce, or the code
 * verifier, none of which the renderer has any business seeing. `null` means refused (state
 * mismatch, exchange failure), with `error` naming why.
 */
export const OAuthResultSchema = z.object({
  session: z
    .object({
      access_token: z.string(),
      refresh_token: z.string(),
      expires_at: z.number().optional(),
    })
    .nullable(),
  error: z.string().optional(),
});
export type OAuthResult = z.infer<typeof OAuthResultSchema>;

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
  'update:progress': UpdateProgressSchema,
  'update:downloaded': UpdateDownloadedSchema,
  'update:error': UpdateErrorSchema,
  'app:justUpdated': AppJustUpdatedSchema,
  'terminal:data': TerminalDataSchema,
  'terminal:exit': TerminalExitSchema,
  'terminal:title': TerminalTitleSchema,
  'analysis:watchEvent': AnalysisWatchEventSchema,
  'workspace:largeProject': WorkspaceLargeProjectSchema,
  'workspace:indexProgress': WorkspaceIndexProgressSchema,
  'auth:callback': AuthCallbackSchema,
  'auth:oauthResult': OAuthResultSchema,
  'license:revalidateNeeded': z.object({}),
  'license:planRevoked': z.object({}),
  'preview:serverDetected': PreviewServerDetectedSchema,
  'preview:titleChanged': PreviewTitleChangedSchema,
  'preview:loadingChanged': PreviewLoadingChangedSchema,
} as const satisfies Record<EventChannel, z.ZodType>;

export type EventContracts = typeof eventContracts;
export type EventPayloadOf<E extends EventChannel> = z.infer<EventContracts[E]>;
