import {
  channels,
  type Channel,
  type RequestOf,
  type ResponseOf,
  type Result,
} from '@fixora/shared-types';
import { contextBridge, ipcRenderer } from 'electron';

/**
 * The preload is the entire surface the renderer has, and it is built *from the registry* —
 * not hand-written channel by channel. That is the difference between a surface you can
 * enumerate and a surface you can only discover.
 *
 * **`ipcRenderer` itself is never exposed.** Handing the renderer `ipcRenderer.invoke` would
 * hand it every channel including ones added later by someone who never thought about the
 * renderer being hostile — which is precisely the shape of a real Electron CVE (ADR-018).
 */

export type FixoraBridge = {
  invoke: <C extends Channel>(channel: C, request: RequestOf<C>) => Promise<Result<ResponseOf<C>>>;
};

const allowed = new Set<string>(channels);

const bridge: FixoraBridge = {
  invoke: async (channel, request) => {
    // The renderer cannot reach a channel that is not in the registry, even if it fabricates
    // the name. Belt and braces: the router validates it again on the privileged side.
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
