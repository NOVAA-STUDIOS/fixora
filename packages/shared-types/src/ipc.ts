import { z } from 'zod';


import {
  AiConfigSchema,
  AiModelListSchema,
  AiRunRequestSchema,
  AiRunResponseSchema,
  ApplyOutcomeSchema,
  ApplyRepairRequestSchema,
  ProceedOutcomeSchema,
  ProceedRunRequestSchema,
  RepairHistoryEntrySchema,
} from './ai.js';
import { FindingSchema, FindingsFilterSchema, FindingsSummarySchema } from './analysis.js';
import type { Channel } from './channels.js';
import { LicenseStatusSchema } from './license.js';
import { PackageListSchema, PackageSearchResponseSchema } from './packages-manager.js';
import { ProviderListSchema } from './providers.js';
import { SearchResponseSchema } from './search.js';
import {
  ShareSuggestionResponseSchema,
  ShareViaGmailResponseSchema,
  SubmitSuggestionRequestSchema,
  SuggestionSchema,
} from './suggestions.js';
import { DirEntrySchema, FileContentSchema, WorkspaceSchema } from './workspace.js';

/**
 * **The entire renderer → main attack surface, enumerable in one file** (ADR-018, TDD §4).
 *
 * The renderer is a browser. It runs a large dependency tree and, from M2, an editor that
 * renders the user's own source code — i.e. untrusted content. Treat it as hostile. Every
 * channel is declared once here as a request/response schema pair, the router validates
 * **both directions** at runtime, and the preload exposes a frozen object built from the
 * channel list. `ipcRenderer` never reaches the renderer.
 *
 * Adding a channel is the moment to ask whether the renderer should be able to do this at all.
 * That question is easy to ask here and impossible to ask when the surface is spread across
 * forty `ipcMain.handle` calls.
 */

export const AppInfoSchema = z.object({
  name: z.string(),
  version: z.string(),
  /** Short git SHA the build came from, or 'unknown' when built without a git checkout. */
  commit: z.string(),
  /**
   * When this bundle was built, ISO-8601.
   *
   * The app could not previously answer "am I running current code?", and a whole debugging session
   * went into a defect that was fixed in source but absent from the installed binary. A build stamp
   * makes that question answerable in one glance instead of by grepping an asar.
   */
  builtAt: z.string(),
  /**
   * Whether the working tree had uncommitted changes when this was built. A commit alone is
   * misleading for a local build: it names code that may not be what was compiled.
   */
  dirty: z.boolean(),
  platform: z.enum(['win32', 'darwin', 'linux']),
  arch: z.string(),
  electronVersion: z.string(),
  isPackaged: z.boolean(),
});
export type AppInfo = z.infer<typeof AppInfoSchema>;

type Contract = { request: z.ZodType; response: z.ZodType };

/**
 * The `Record<Channel, Contract>` constraint is the thing that keeps `channels.ts` (which the
 * preload reads) and this registry (which the router reads) from drifting apart. Declare a
 * channel without a contract, or a contract without a channel, and it is a compile error —
 * not a runtime surprise on the one code path that is a security boundary.
 *
 * The M0 channel set is exactly one channel, and that is the point: it proves the pattern
 * end-to-end with no product surface to hide behind. Workspace, filesystem, analysis, AI and
 * patch channels arrive with the milestones that implement them — a declared channel with no
 * handler is a placeholder, and Standards §2 does not allow those. (The router asserts this at
 * startup rather than trusting us to remember.)
 */
const empty = z.object({});
const WindowStateSchema = z.object({ isMaximized: z.boolean() });

export const contracts = {
  'system:getAppInfo': {
    request: empty,
    response: AppInfoSchema,
  },
  // GitHub Releases, fetched from main (Security §2: the renderer's CSP has no connect-src for
  // api.github.com). An empty array is a valid, non-error outcome (offline, no releases yet) —
  // same posture as packages:search degrading to no results rather than an error.
  'system:getChangelog': {
    request: empty,
    response: z.object({
      releases: z.array(
        z.object({ version: z.string(), date: z.string(), body: z.string() }),
      ),
    }),
  },
  // GPU compositing preference (Windows only elsewhere on non-Windows there is nothing to disable,
  // so both read false/no-op — Settings still shows the toggle, it simply has no effect there).
  // A manual change here takes effect on the NEXT launch, not live — the Chromium switch that
  // controls this must be set before the GPU process starts.
  'system:getGpuPreference': {
    request: empty,
    response: z.object({ disableCompositing: z.boolean(), platformSupported: z.boolean() }),
  },
  'system:setGpuCompositingDisabled': {
    request: z.object({ disabled: z.boolean() }),
    response: z.void(),
  },
  // Custom title bar (frameless window). These are the privileged operations the renderer's
  // window-control buttons need — the renderer cannot minimise or close a window itself, by
  // design, so it asks main to. Each returns the resulting window state so the button's
  // maximise/restore icon can update without a second round-trip.
  'window:minimize': { request: empty, response: WindowStateSchema },
  'window:toggleMaximize': { request: empty, response: WindowStateSchema },
  'window:close': { request: empty, response: z.void() },
  'window:isMaximized': { request: empty, response: WindowStateSchema },

  // Workspace + filesystem. `relPath` is workspace-relative; main pairs it with the root it owns
  // and runs it through the path guard, so the renderer cannot reach outside the workspace.
  // Hand a path to the OS file manager. The renderer supplies it, so main only honours paths it
  // already knows as recents — the same authorization rule as opening a folder. Anything else and
  // a hostile renderer could use the app to pop Explorer windows anywhere on the disk.
  'system:revealInFolder': {
    request: z.object({ path: z.string().min(1) }),
    response: z.object({ revealed: z.boolean() }),
  },

  /**
   * Write text to the system clipboard, from MAIN.
   *
   * The renderer cannot do this itself and must not be given the ability to: the session denies every
   * web permission by default (`setPermissionCheckHandler(() => false)`), which is the correct posture
   * for a window that renders other people's source code — and it means `navigator.clipboard.writeText`
   * rejects. Relaxing the permission to fix Copy would trade a real security property for a button.
   * Main owns the clipboard instead, so the renderer asks rather than reaches.
   */
  'system:copyToClipboard': {
    request: z.object({ text: z.string() }),
    response: z.object({ copied: z.boolean() }),
  },

  'workspace:pickFolder': {
    request: empty,
    // null when the user cancels the native dialog.
    response: z.object({ path: z.string().nullable() }),
  },
  'workspace:open': {
    request: z.object({ path: z.string().min(1) }),
    response: z.object({ workspace: WorkspaceSchema }),
  },
  'workspace:recent': {
    request: empty,
    response: z.object({ workspaces: z.array(WorkspaceSchema) }),
  },
  // Removing a recent is a *list* operation and nothing more: it forgets the entry, it never
  // touches a single byte on disk. The renderer supplies an id, not a path, so this cannot be
  // aimed at an arbitrary folder even if the renderer is hostile.
  'workspace:removeRecent': {
    request: z.object({ id: z.string().min(1) }),
    response: z.object({ workspaces: z.array(WorkspaceSchema) }),
  },
  'workspace:clearRecent': {
    request: empty,
    response: z.object({ workspaces: z.array(WorkspaceSchema) }),
  },
  'workspace:current': {
    request: empty,
    response: z.object({ workspace: WorkspaceSchema.nullable() }),
  },
  // Closing the workspace. Main forgets the trusted root and stops watching the folder, so every
  // path-guarded handler goes back to refusing — closing is a real teardown, not a renderer-side blank.
  'workspace:close': {
    request: z.object({}),
    response: z.void(),
  },
  // Sprint F2 (Welcome Experience): pin/unpin a recent project. A list-ordering preference, not a
  // security fact — the renderer supplies an id, not a path, same trust shape as removeRecent.
  'workspace:setPinned': {
    request: z.object({ id: z.string().min(1), pinned: z.boolean() }),
    response: z.object({ workspaces: z.array(WorkspaceSchema) }),
  },

  'fs:listDir': {
    request: z.object({ relPath: z.string() }),
    response: z.object({ entries: z.array(DirEntrySchema) }),
  },
  'fs:readFile': {
    request: z.object({ relPath: z.string().min(1) }),
    response: z.object({ file: FileContentSchema }),
  },
  // Saving an edited file. Same guards as reading: workspace-relative, path-guarded, and refused for
  // a secrets-denylisted path. The renderer can only ever write inside the open workspace.
  'fs:writeFile': {
    request: z.object({ relPath: z.string().min(1), content: z.string() }),
    response: z.void(),
  },
  'fs:createFile': {
    request: z.object({ relPath: z.string().min(1) }),
    response: z.void(),
  },
  'fs:createDir': {
    request: z.object({ relPath: z.string().min(1) }),
    response: z.void(),
  },
  'fs:rename': {
    request: z.object({ fromRelPath: z.string().min(1), toRelPath: z.string().min(1) }),
    response: z.void(),
  },
  'fs:delete': {
    request: z.object({ relPath: z.string().min(1) }),
    response: z.void(),
  },

  // Analysis (M3). `analysis:run` kicks off a workspace analysis in the isolated utility process
  // (ADR-017); findings stream back as `analysis:findingsAdded` events and are persisted, so the
  // panel reads them with `analysis:list`/`analysis:summary` and survives a restart. The renderer
  // never runs a tool — it asks main, which owns the workspace root and the worker.
  'analysis:run': { request: empty, response: z.void() },
  'analysis:cancel': { request: empty, response: z.void() },
  'analysis:list': {
    request: z.object({ filter: FindingsFilterSchema.optional() }),
    response: z.object({ findings: z.array(FindingSchema) }),
  },
  'analysis:summary': { request: empty, response: FindingsSummarySchema },

  // AI (M5, BYOK). Config is readable/settable by the renderer, but the key is write-only from its
  // point of view: `providers:setKey` takes one and it goes to the OS keychain; nothing returns it.
  // `ai:run` executes a grounded task against a finding — the secret gate runs inside, before any
  // provider call — and streams prose via `ai:delta`, resolving to a typed outcome value.
  /**
   * Every provider mutation returns the FULL refreshed list rather than an ack.
   *
   * Reordering is relative (swap with a neighbour), so a renderer that applied the change locally
   * would be re-deriving an order main already computed — and the two would drift the first time a
   * provider appeared or a write failed. Returning the list makes main the single authority.
   */
  'providers:list': { request: empty, response: ProviderListSchema },
  'providers:setEnabled': {
    request: z.object({ id: z.string().min(1), enabled: z.boolean() }),
    response: ProviderListSchema,
  },
  'providers:moveUp': { request: z.object({ id: z.string().min(1) }), response: ProviderListSchema },
  'providers:moveDown': {
    request: z.object({ id: z.string().min(1) }),
    response: ProviderListSchema,
  },
  'providers:listModels': {
    request: z.object({
      id: z.string().min(1),
      /** Bypass the session cache. Settings passes this on an explicit refresh. */
      refresh: z.boolean().optional(),
    }),
    response: z.object({
      models: z.array(z.string()),
      /**
       * Where the list came from, because the two carry different authority: `live` is what the
       * provider says it serves right now, `curated` is compiled in and may be behind.
       */
      source: z.enum(['live', 'curated', 'none']),
      /** Why the live call did not happen or did not work. Null when it did. */
      notice: z.string().nullable(),
    }),
  },
  'providers:setModel': {
    request: z.object({ id: z.string().min(1), model: z.string() }),
    response: ProviderListSchema,
  },
  'providers:setBaseUrl': {
    request: z.object({ id: z.string().min(1), baseUrl: z.string() }),
    response: ProviderListSchema,
  },
  /**
   * Save a key for ONE named provider. The id is the point: the removed `ai:setKey` hardcoded
   * OpenRouter, which made every provider after the first unusable.
   */
  'providers:setKey': {
    request: z.object({
      id: z.string().min(1),
      key: z.string().min(1),
      /** Move this provider to the head of the failover chain. The primary field sets it. */
      makePrimary: z.boolean().optional(),
    }),
    response: ProviderListSchema,
  },
  'providers:clearKey': {
    request: z.object({ id: z.string().min(1) }),
    response: ProviderListSchema,
  },
  /**
   * First-run agreement. Read on launch; the shell renders nothing else until it answers.
   *
   * `decline` quits the app, so it has no meaningful response — the renderer never sees one.
   */
  'consent:get': {
    request: z.object({}),
    response: z.object({ accepted: z.boolean() }),
  },
  'consent:accept': {
    request: z.object({}),
    response: z.object({ accepted: z.boolean() }),
  },
  'consent:decline': {
    request: z.object({}),
    response: z.object({}),
  },
  'ai:getConfig': { request: empty, response: AiConfigSchema },
  'ai:setModel': { request: z.object({ model: z.string().min(1) }), response: AiConfigSchema },
  // The live OpenRouter catalogue, for the model picker. Public endpoint, no key involved — the
  // list can be shown before the user has configured anything.
  'ai:listModels': {
    request: z.object({ refresh: z.boolean().optional() }),
    response: AiModelListSchema,
  },
  'ai:run': { request: AiRunRequestSchema, response: AiRunResponseSchema },
  'ai:cancel': { request: empty, response: z.void() },
  // Proceed Mode: a natural-language instruction + the caret, answered with a VERIFIED edit proposal
  // (or an exact refusal). Never writes — applying reuses `ai:applyRepair` below.
  'proceed:run': { request: ProceedRunRequestSchema, response: ProceedOutcomeSchema },
  // Aborts the in-flight `proceed:run` request (Q3 Defect #4) — same shape as `ai:cancel`.
  'proceed:cancel': { request: empty, response: z.void() },
  // Apply a verified repair to the file on disk (path-guarded in main). The renderer sends the target
  // range + the repaired code; main splices and writes. Returns void — the editor + analysis refresh.
  // Returns a structured outcome rather than throwing: a stale range is an expected condition the
  // user can act on, and a thrown error would be redacted to a generic string by the router.
  'ai:applyRepair': { request: ApplyRepairRequestSchema, response: ApplyOutcomeSchema },
  // The local repair audit trail for the open workspace, newest first.
  'ai:history': {
    request: empty,
    response: z.object({ entries: z.array(RepairHistoryEntrySchema) }),
  },

  // History entries are a local audit trail, so the user owns them and may delete them. Deleting
  // an entry removes the record of a repair; it never reverts or alters the file the repair touched.
  'ai:historyRemove': {
    request: z.object({ id: z.string().min(1) }),
    response: z.object({ entries: z.array(RepairHistoryEntrySchema) }),
  },
  'ai:historyClear': {
    request: empty,
    response: z.object({ entries: z.array(RepairHistoryEntrySchema) }),
  },

  // Licensing (Beta). Offline Ed25519-verified. `activate` takes a signed key and returns the resulting
  // entitlement; nothing here is a secret, but the key never round-trips back out either.
  'license:get': { request: empty, response: LicenseStatusSchema },
  'license:activate': {
    request: z.object({ key: z.string().min(1) }),
    response: LicenseStatusSchema,
  },
  'license:deactivate': { request: empty, response: LicenseStatusSchema },

  // Sprint F1 (Suggestion System). Local-only: a suggestion never leaves the machine except through
  // the explicit, user-initiated 'suggestions:export', which writes a file the user picks via a
  // native save dialog and never uploads anything.
  'suggestions:submit': {
    request: SubmitSuggestionRequestSchema,
    response: z.object({ suggestion: SuggestionSchema }),
  },
  'suggestions:list': {
    request: empty,
    response: z.object({ suggestions: z.array(SuggestionSchema) }),
  },
  // A suggestion is the user's own note to themselves and to us; deleting one removes only the
  // local record, same discipline as ai:historyRemove above.
  'suggestions:remove': {
    request: z.object({ id: z.string().min(1) }),
    response: z.object({ suggestions: z.array(SuggestionSchema) }),
  },
  'suggestions:clear': {
    request: empty,
    response: z.object({ suggestions: z.array(SuggestionSchema) }),
  },
  // `path` is null when the user cancels the native save dialog — not an error.
  'suggestions:export': {
    request: empty,
    response: z.object({ path: z.string().nullable() }),
  },
  // Sprint F1.1 / F1.4 (MailService). Main looks the suggestion up by id itself (never trusts a
  // renderer-supplied category/message pair for what goes in the email) and composes the mailto:
  // link with a fixed recipient and scheme via MailService — the request carries no URL.
  // `not_found` means the id no longer exists (e.g. deleted in another window); `no_mail_client`
  // means MailService could not confirm a handler is registered on this machine and carries the
  // composed `to`/`subject` back so the renderer can offer Copy Email / Copy Subject.
  'suggestions:share': {
    request: z.object({ id: z.string().min(1) }),
    response: ShareSuggestionResponseSchema,
  },
  // Sprint F1.5. The user explicitly chose "Open Gmail" from the no-mail-client dialog. Same trust
  // rule as 'suggestions:share': main re-derives to/subject/body from the suggestion id, never from
  // a renderer-supplied value. `browser_failed` means shell.openExternal itself could not launch a
  // browser for the Gmail compose URL.
  'suggestions:shareViaGmail': {
    request: z.object({ id: z.string().min(1) }),
    response: ShareViaGmailResponseSchema,
  },
  // Applies an update `update:downloaded` already reported ready. Quits and restarts, so there is
  // no response to wait for — the process that would receive it is the one being replaced.
  'update:install': { request: empty, response: z.void() },

  // Integrated terminal (node-pty). One PTY session per `id`, which the renderer mints — a UUID
  // per terminal tab — so main never has to hand back a session handle for the renderer to hold.
  'terminal:create': {
    request: z.object({
      id: z.string().min(1),
      cols: z.number().int().positive(),
      rows: z.number().int().positive(),
      // A `shell-detection.ts` id ('powershell'|'cmd'|'git-bash'|'wsl'|...); omitted or unknown
      // falls back to the platform default rather than erroring — see terminal-service.ts.
      shellId: z.string().optional(),
    }),
    response: z.object({ shell: z.string() }),
  },
  'terminal:listShells': {
    request: empty,
    response: z.object({
      shells: z.array(
        z.object({ id: z.string(), label: z.string(), command: z.string(), args: z.array(z.string()) }),
      ),
    }),
  },
  // Raw keystrokes/paste data, unvalidated beyond "is a string" — a terminal's whole job is to
  // accept arbitrary bytes and hand them to the shell; that is not a channel this app can sanitise.
  'terminal:write': {
    request: z.object({ id: z.string().min(1), data: z.string() }),
    response: z.void(),
  },
  'terminal:resize': {
    request: z.object({ id: z.string().min(1), cols: z.number().int().positive(), rows: z.number().int().positive() }),
    response: z.void(),
  },
  'terminal:dispose': {
    request: z.object({ id: z.string().min(1) }),
    response: z.void(),
  },

  // Full-text search. One-shot: main chunks/yields internally (search-service.ts) so it never
  // blocks the event loop even on a 100k+ file project, and a stale request's response is simply
  // ignored by the renderer (a generation counter) when a newer one has already been sent — no
  // separate cancel channel needed, unlike analysis which is a long-lived streamed run.
  'search:query': {
    request: z.object({ query: z.string().min(1) }),
    response: SearchResponseSchema,
  },

  'packages:list': { request: empty, response: PackageListSchema },
  // npm/PyPI registry search — a network call FROM MAIN, never from the renderer directly (the
  // renderer has no fetch to the outside world under the CSP; Security §2). Empty results is a
  // valid, non-error outcome (offline, no matches), not something the caller needs to distinguish
  // from "found nothing" — errors surface through the ordinary IPC error channel.
  'packages:search': {
    request: z.object({ query: z.string().min(1) }),
    response: PackageSearchResponseSchema,
  },

  'editor:formatFile': {
    request: z.object({ relPath: z.string().min(1) }),
    response: z.object({
      ran: z.boolean(),
      ok: z.boolean(),
      formatter: z.string().nullable(),
      message: z.string().nullable(),
      content: z.string(),
    }),
  },

  'editor:gitBlame': {
    request: z.object({ relPath: z.string().min(1) }),
    response: z.object({
      lines: z.array(
        z.object({
          line: z.number().int().positive(),
          author: z.string(),
          authorTimeUnix: z.number().int().nonnegative(),
          summary: z.string(),
        }),
      ),
    }),
  },

  'git:status': {
    request: empty,
    response: z.object({
      branch: z.string().nullable(),
      staged: z.array(z.object({ path: z.string(), status: z.string() })),
      unstaged: z.array(z.object({ path: z.string(), status: z.string() })),
    }),
  },
  'git:stage': { request: z.object({ relPath: z.string().min(1) }), response: z.void() },
  'git:unstage': { request: z.object({ relPath: z.string().min(1) }), response: z.void() },
  'git:commit': { request: z.object({ message: z.string().min(1) }), response: z.void() },

  'project:create': {
    request: z.object({
      parentDir: z.string().min(1),
      name: z.string().min(1),
      templateId: z.string().min(1),
    }),
    response: z.object({ path: z.string() }),
  },
} as const satisfies Record<Channel, Contract>;

export type Contracts = typeof contracts;

export type RequestOf<C extends Channel> = z.infer<Contracts[C]['request']>;
export type ResponseOf<C extends Channel> = z.infer<Contracts[C]['response']>;
