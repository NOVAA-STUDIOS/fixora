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
  'window:minimize',
  'window:toggleMaximize',
  'window:close',
  'window:isMaximized',
  'workspace:pickFolder',
  'workspace:open',
  'workspace:recent',
  'workspace:current',
  'fs:listDir',
  'fs:readFile',
  'analysis:run',
  'analysis:cancel',
  'analysis:list',
  'analysis:summary',
  'ai:getConfig',
  'ai:setKey',
  'ai:clearKey',
  'ai:setModel',
  'ai:run',
  'ai:cancel',
  'ai:applyRepair',
  'ai:history',
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
] as const;

export type EventChannel = (typeof eventChannels)[number];

const eventChannelSet = new Set<string>(eventChannels);

export function isEventChannel(value: string): value is EventChannel {
  return eventChannelSet.has(value);
}
