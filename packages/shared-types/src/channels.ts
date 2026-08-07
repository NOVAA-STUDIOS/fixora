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
  'system:getAppInfo',
  'system:revealInFolder',
  'system:copyToClipboard',
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
  'analysis:run',
  'analysis:cancel',
  'analysis:list',
  'analysis:summary',
  // Provider management. The registry, the failover chain and the health store all existed and were
  // unreachable — no channel named them, so priority and enable/disable were headless.
  'providers:list',
  'providers:setEnabled',
  'providers:moveUp',
  'providers:moveDown',
  'providers:setModel',
  // Available models for one provider — live from its API where it has one, curated otherwise.
  'providers:listModels',
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
  'ai:history',
  'ai:historyRemove',
  'ai:historyClear',
  // Proceed Mode (P2.2R): natural-language editing. Apply deliberately reuses `ai:applyRepair` —
  // there is exactly one verified write path in the app and Proceed does not get a second one.
  'proceed:run',
  'proceed:cancel',
  'license:get',
  'license:activate',
  'license:deactivate',
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
  'update:downloaded',
  'update:error',
  // Terminal output/exit, streamed per-session (keyed by the id `terminal:create` returned).
  'terminal:data',
  'terminal:exit',
  // Fired once, after the background file index finishes, when the workspace is large enough
  // that the user should know analysis/tree performance is affected (default ignores already
  // exclude node_modules/dist/build/etc — see ignore-rules.ts — this is informational, not a
  // request for a decision).
  'workspace:largeProject',
] as const;

export type EventChannel = (typeof eventChannels)[number];

const eventChannelSet = new Set<string>(eventChannels);

export function isEventChannel(value: string): value is EventChannel {
  return eventChannelSet.has(value);
}
