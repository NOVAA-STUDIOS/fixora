/**
 * The channel names — and **nothing else**. This module does not import zod, and must never
 * import zod, because the preload imports this module. An ESLint rule and a bundle test enforce
 * it (see apps/desktop/electron/preload).
 *
 * Why that matters: the preload is the one script that runs *with* `contextBridge` privileges
 * in an otherwise sandboxed renderer. It is the single most security-sensitive file we ship.
 * Every byte of third-party code in it is attack surface in the worst possible place, and it is
 * executed on every window creation, before first paint, against a 2.0 s cold-start budget
 * (PRD §7).
 *
 * The preload does not need to *validate* anything — the router revalidates every request on
 * the privileged side, and the emitter validates every event before it leaves main; the
 * privileged side is the only side whose validation an attacker cannot own. The preload needs
 * two lists of strings: the request/response channels, and the main→renderer event channels.
 *
 * `ipc.ts` and `events.ts` build their zod registries keyed by these lists and are
 * type-constrained to cover them exactly, so the two halves cannot drift.
 */

/** Renderer → main request/response channels (invoke). */
export const channels = [
  // Polled by the renderer's splash (`app-ready.ts`) until main has finished constructing every
  // service and registering every handler — a pull, not a push, so it can never race a listener
  // that hasn't subscribed yet the way the old `app:ready` event could.
  'app:getReadyState',
  'app:relaunch',
  'system:getAppInfo',
  'system:getChangelog',
  'system:getGpuPreference',
  'system:setGpuCompositingDisabled',
  'system:revealInFolder',
  'system:copyToClipboard',
  'system:openExternal',
  // PKCE + loopback OAuth (RFC 8252) — starts the flow; the result arrives via the
  // 'auth:oauthResult' event once the loopback server receives the provider's redirect.
  'auth:startOAuth',
  'license:validate',
  'license:getRepairCount',
  // Local-only referral system (no external backend): a per-device code, one redemption ever,
  // both surfaced from the same single-row `referrals` table.
  'referral:getMyCode',
  'referral:redeem',
  'referral:getStatus',
  'window:minimize',
  'window:toggleMaximize',
  'window:close',
  'window:isMaximized',
  'workspace:pickFolder',
  'workspace:open',
  'workspace:recent',
  'workspace:removeRecent',
  'workspace:clearRecent',
  'workspace:current',
  'workspace:close',
  // Sprint F2 (Welcome Experience): pin/unpin a recent project.
  'workspace:setPinned',
  'fs:listDir',
  'fs:readFile',
  'fs:writeFile',
  // GitHub Actions panel (settings): writes a generated file, creating parent directories —
  // unlike fs:writeFile (existing files only) and fs:createFile (refuses an existing path).
  'fs:writeWorkspaceFile',
  // File tree context menu / "+" button: New File, New Folder, Rename, Delete.
  'fs:createFile',
  'fs:createDir',
  'fs:rename',
  'fs:delete',
  // Pre-commit hook panel (settings): writes/removes/reads `.git/hooks/pre-commit`.
  'hook:install',
  'hook:remove',
  'hook:status',
  'analysis:run',
  'analysis:cancel',
  'analysis:list',
  'analysis:summary',
  // Watch Mode: re-analyze a file on save, without a full-project run.
  'analysis:watchStart',
  'analysis:watchStop',
  // Provider management. The registry, the failover chain and the health store all existed and were
  // unreachable — no channel named them, so priority and enable/disable were headless.
  'providers:list',
  'providers:setEnabled',
  'providers:moveUp',
  'providers:moveDown',
  'providers:setModel',
  // Available models for one provider — live from its API where it has one, curated otherwise.
  'providers:listModels',
  // Same, batched: one round trip for every provider a caller names, instead of one call per
  // provider row — the settings panel used to fire N of the above simultaneously on mount.
  'providers:listAllModels',
  'providers:setBaseUrl',
  // Per-provider credentials. `ai:setKey` writes only the OpenRouter slot by construction, so a
  // user pasting a Gemini key silently overwrote their OpenRouter one — these take the id.
  'providers:setKey',
  'providers:clearKey',
  // First-run agreement to the Terms and Privacy Policy.
  'consent:get',
  'consent:accept',
  'consent:decline',
  'ai:getConfig',
  'ai:setModel',
  'ai:listModels',
  'ai:run',
  'ai:cancel',
  'ai:applyRepair',
  // "Repair All": brackets a sequential run of `ai:applyRepair` calls so their history writes are
  // buffered in main and committed as one `driver.transaction()` at the end, instead of one commit
  // per repair.
  'ai:bulkRepairStart',
  'ai:bulkRepairFlush',
  'ai:history',
  'ai:historyRemove',
  'ai:historyClear',
  'ai:historyByFile',
  'ai:getStats',
  'shield:analyze',
  'shield:getSettings',
  'shield:saveSettings',
  // Test generation (feature #7): grounds on a file, not a finding — a separate, additive path.
  'ai:generateTests',
  // Embedded MCP server (feature #10): called in-process by mcp-server.ts (getHandler, not a real
  // IPC round trip), reusing the same logic these channels' handlers back onto for the renderer.
  'mcp:getFindings',
  'mcp:triggerAnalysis',
  'mcp:analyzeFile',
  'mcp:repairFinding',
  'mcp:getStatus',
  // The user-facing capability switch + whether the server is actually running right now.
  'mcp:getSetting',
  'mcp:setEnabled',
  // OS-level notification, shown only while the app is unfocused (notifications.handlers.ts).
  'notifications:show',
  // Proceed Mode (P2.2R): natural-language editing. Apply deliberately reuses `ai:applyRepair` —
  // there is exactly one verified write path in the app and Proceed does not get a second one.
  'proceed:run',
  'proceed:cancel',
  // Sprint F1: the Suggestion System. Local-only — no channel here ever leaves the machine except
  // through the explicit, user-initiated 'suggestions:export'.
  'suggestions:submit',
  'suggestions:list',
  'suggestions:remove',
  'suggestions:clear',
  'suggestions:export',
  // Sprint F1.1: compose a pre-filled feedback email in the user's default mail client.
  'suggestions:share',
  // Sprint F1.5: the Gmail web-compose fallback, offered when 'suggestions:share' reports
  // no_mail_client.
  'suggestions:shareViaGmail',
  // Auto-update. The renderer never drives the check — main starts it on launch — this is the one
  // decision that stays with the user: applying the already-downloaded update quits and restarts.
  'update:install',
  // Integrated terminal. `create` spawns a shell rooted at the open workspace; `write`/`resize`
  // drive the running session; `dispose` kills it. One session per terminal tab, keyed by id.
  'terminal:create',
  'terminal:write',
  'terminal:resize',
  'terminal:dispose',
  'terminal:listShells',
  // Full-text project search (one-shot request/response — see search-service.ts for why this
  // doesn't need a cancel channel the way analysis does).
  'search:query',
  // Package Manager tab. Listing/searching are the only main-process work — install/uninstall run
  // as an ordinary command in the real Terminal tab (a pending-command handoff in ui-store), not a
  // separate execution path, so "shown in terminal" and "handles errors gracefully" both fall out
  // of it being a real shell rather than something this app has to interpret the outcome of.
  'packages:list',
  'packages:search',
  // Tasks Runner: every script in the open workspace's package.json, run in the real Terminal
  // tab (openWithCommand) — same "never executed by main" posture as Package Manager's own
  // install/uninstall above.
  'tasks:list',
  // Format-on-save: run the workspace's own formatter (Prettier/Ruff) against a file already
  // written to disk, and return its content afterward so the editor model can be refreshed.
  'editor:formatFile',
  // Git blame for the open file — best-effort (see git-blame-service.ts): a project with no repo,
  // no git binary, or an untracked file all resolve to an empty result, never an error.
  'editor:gitBlame',
  // Source Control tab: status/stage/unstage/commit, all shelling out to the user's own `git` —
  // best-effort, same as editor:gitBlame (no repo/no git binary resolves gracefully, never errors).
  'git:status',
  'git:stage',
  'git:unstage',
  'git:commit',
  'git:diff',
  'git:push',
  'git:pull',
  'git:fetch',
  'git:branches',
  'git:checkout',
  // New Project: runs a template's scaffold command as a plain background child process (never a
  // visible terminal) rooted at a directory the user picked, gated by the same authorization rule
  // workspace:open uses.
  'project:create',
  // Fixora Preview: an embedded WebContentsView showing the user's own localhost dev server —
  // never anything else (Security §2's localhost-only navigation guard, preview-service.ts).
  'preview:detect',
  'preview:open',
  'preview:close',
  'preview:refresh',
  'preview:resize',
  'preview:getState',
  'preview:checkDevScript',
  'preview:launchDevServer',
  'preview:launchAndPreview',
  'preview:hide',
  'preview:show',
  'preview:goBack',
  'preview:goForward',
] as const;

export type Channel = (typeof channels)[number];

const channelSet = new Set<string>(channels);

export function isChannel(value: string): value is Channel {
  return channelSet.has(value);
}

/**
 * Main → renderer event channels (push). Unidirectional, fire-and-forget, one payload schema
 * each (declared in events.ts). The renderer subscribes; it cannot emit these.
 */
export const eventChannels = [
  'window:maximizedChanged',
  'workspace:filesChanged',
  'analysis:findingsAdded',
  'analysis:state',
  'ai:delta',
  'ai:runState',
  'update:available',
  'update:progress',
  'update:downloaded',
  'update:error',
  // Fired once per update, after `app:ready` — never on a fresh install (whats-new-dialog.tsx).
  'app:justUpdated',
  // Terminal output/exit, streamed per-session (keyed by the id `terminal:create` returned).
  'terminal:data',
  'terminal:exit',
  'terminal:title',
  // Fired once, after the background file index finishes, when the workspace is large enough
  // that the user should know analysis/tree performance is affected (default ignores already
  // exclude node_modules/dist/build/etc — see ignore-rules.ts — this is informational, not a
  // request for a decision).
  'workspace:largeProject',
  // Background indexing progress, on a long walk (status-bar.tsx). Not a percentage — the total
  // file count isn't known until the walk finishes, so nothing here fabricates one.
  'workspace:indexProgress',
  // The `fixora://auth/callback` URL the OS hands back after the system-browser OAuth round trip.
  // No longer emitted (PKCE + loopback replaced this path) — kept declared since nothing has
  // removed the type-level contract for it yet.
  'auth:callback',
  // PKCE + loopback OAuth result (RFC 8252): the exchanged session, or a refusal (state mismatch,
  // exchange failure). Never carries the raw provider redirect URL or the code verifier.
  'auth:oauthResult',
  // Watch Mode status pushes (analysis.handlers.ts) — a change was detected, a re-analysis started
  // for it, or that re-analysis finished.
  'analysis:watchEvent',
  // Main holds no paid plan for this device (repair-limit.ts), so a user who activated before the
  // plan moved main-side would silently be metered as free. Asks the renderer — which still has
  // the license key — to re-run `license:validate` and restore it.
  'license:revalidateNeeded',
  // A stored licence failed its periodic Gumroad check — the plan has already been reverted in
  // main, and the renderer must stop showing the paid tier.
  'license:planRevoked',
  // Fixora Preview: a localhost dev server was found by the port scanner, or the embedded view's
  // title/loading state changed.
  'preview:serverDetected',
  'preview:titleChanged',
  'preview:loadingChanged',
  'preview:statusUpdate',
  'preview:navigationChanged',
] as const;

export type EventChannel = (typeof eventChannels)[number];

const eventChannelSet = new Set<string>(eventChannels);

export function isEventChannel(value: string): value is EventChannel {
  return eventChannelSet.has(value);
}
