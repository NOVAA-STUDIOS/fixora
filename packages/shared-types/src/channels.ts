/**
 * The channel names — and **nothing else**. This module does not import zod, and must never
 * import zod, because the preload imports this module. A dependency-cruiser rule enforces it.
 *
 * Why that matters: the preload is the one script that runs *with* `contextBridge` privileges
 * in an otherwise sandboxed renderer. It is the single most security-sensitive file we ship.
 * Every byte of third-party code in it is attack surface in the worst possible place, and it
 * is executed on every window creation, before first paint, against a 2.0 s cold-start budget
 * (PRD §7).
 *
 * The preload does not need to *validate* anything — the router revalidates everything on the
 * privileged side, which is the only side whose validation is trustworthy anyway. It needs a
 * list of strings. So it gets a list of strings.
 *
 * `ipc.ts` builds the contract registry keyed by this list and is type-constrained to cover it
 * exactly, so the two cannot drift: adding a channel here without a contract is a compile
 * error, and vice versa.
 */
export const channels = ['system:getAppInfo'] as const;

export type Channel = (typeof channels)[number];

const channelSet = new Set<string>(channels);

export function isChannel(value: string): value is Channel {
  return channelSet.has(value);
}
