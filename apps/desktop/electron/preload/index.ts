import type { RequestOf, ResponseOf, Result } from '@fixora/shared-types';
import { channels, type Channel } from '@fixora/shared-types/channels';
import { contextBridge, ipcRenderer } from 'electron';

/**
 * The preload is the entire surface the renderer has, and it is built *from the channel list* —
 * not hand-written channel by channel. That is the difference between a surface you can
 * enumerate and a surface you can only discover.
 *
 * **`ipcRenderer` itself is never exposed.** Handing the renderer `ipcRenderer.invoke` would
 * hand it every channel including ones added later by someone who never thought about the
 * renderer being hostile — which is precisely the shape of a real Electron CVE (ADR-018).
 *
 * **This file imports the zod-free `/channels` entry point, never the barrel.** The preload is
 * the most privileged script we ship and it runs before first paint on every window; pulling a
 * schema library into it costs ~120 kB of cold start and puts a large third-party parser into
 * the one place we least want one. It does not need to validate: the router revalidates on the
 * privileged side, and that is the only side whose validation means anything. A
 * dependency-cruiser rule (`preload-stays-minimal`) fails the build if zod finds its way back.
 *
 * The type-only imports below are erased at compile time and cost nothing at runtime.
 */

export type FixoraBridge = {
  invoke: <C extends Channel>(channel: C, request: RequestOf<C>) => Promise<Result<ResponseOf<C>>>;
};

const allowed = new Set<string>(channels);

const bridge: FixoraBridge = {
  invoke: async (channel, request) => {
    // The renderer cannot reach a channel that is not in the registry, even if it fabricates
    // the name. Belt and braces: the router checks again on the privileged side, because a
    // check that runs in the renderer's process is a check an attacker owns.
    if (!allowed.has(channel)) {
      throw new Error(`Unknown IPC channel: ${channel}`);
    }

    const requestId = crypto.randomUUID();
    return (await ipcRenderer.invoke(channel, { requestId, payload: request })) as Promise<
      Result<ResponseOf<typeof channel>>
    >;
  },
};

// Frozen: the renderer must not be able to monkey-patch the bridge and have a later caller
// (or a compromised dependency) transparently reroute an invocation.
contextBridge.exposeInMainWorld('fixora', Object.freeze(bridge));
