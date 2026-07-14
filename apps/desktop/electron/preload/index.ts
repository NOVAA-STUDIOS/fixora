import type { EventPayloadOf, RequestOf, ResponseOf, Result } from '@fixora/shared-types';
import {
  channels,
  eventChannels,
  type Channel,
  type EventChannel,
} from '@fixora/shared-types/channels';
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

/**
 * The preload is the entire surface the renderer has, and it is built *from the channel lists* —
 * not hand-written channel by channel. That is the difference between a surface you can
 * enumerate and a surface you can only discover.
 *
 * **`ipcRenderer` itself is never exposed.** Handing the renderer `ipcRenderer` would hand it
 * every channel including ones added later by someone who never thought about the renderer being
 * hostile — precisely the shape of a real Electron CVE (ADR-018). It gets `invoke` and
 * `subscribe`, each clamped to the declared channel allowlists.
 *
 * **This file imports the zod-free `/channels` entry point, never the barrel.** The preload is
 * the most privileged script we ship and it runs before first paint on every window; a schema
 * library here costs ~120 kB of cold start and puts a large third-party parser in the worst
 * place. It does not validate: the router validates every inbound request and the emitter
 * validates every outbound event, both on the privileged side — the only side an attacker does
 * not own. An ESLint rule and a bundle test keep zod out. The type-only imports below are erased
 * at compile time and cost nothing at runtime.
 */

export type FixoraBridge = {
  invoke: <C extends Channel>(channel: C, request: RequestOf<C>) => Promise<Result<ResponseOf<C>>>;
  /** Subscribe to a main→renderer event. Returns an unsubscribe function. */
  subscribe: <E extends EventChannel>(
    channel: E,
    listener: (payload: EventPayloadOf<E>) => void,
  ) => () => void;
};

const allowedChannels = new Set<string>(channels);
const allowedEvents = new Set<string>(eventChannels);

const bridge: FixoraBridge = {
  invoke: async (channel, request) => {
    // The renderer cannot reach a channel that is not in the registry, even if it fabricates the
    // name. Belt and braces: the router checks again on the privileged side, because a check that
    // runs in the renderer's process is a check an attacker owns.
    if (!allowedChannels.has(channel)) {
      throw new Error(`Unknown IPC channel: ${channel}`);
    }
    const requestId = crypto.randomUUID();
    return (await ipcRenderer.invoke(channel, { requestId, payload: request })) as Promise<
      Result<ResponseOf<typeof channel>>
    >;
  },

  subscribe: (channel, listener) => {
    if (!allowedEvents.has(channel)) {
      throw new Error(`Unknown IPC event channel: ${channel}`);
    }
    // The payload was validated by the emitter on the main side before it was sent. We forward
    // it; the renderer's typed bridge gives it a shape. We do not hand the renderer the raw
    // IpcRendererEvent (it carries `sender` and other capabilities the renderer must not have).
    const handler = (_event: IpcRendererEvent, payload: unknown): void => {
      listener(payload as EventPayloadOf<typeof channel>);
    };
    ipcRenderer.on(channel, handler);
    return () => {
      ipcRenderer.removeListener(channel, handler);
    };
  },
};

// Frozen: the renderer must not be able to monkey-patch the bridge and have a later caller (or a
// compromised dependency) transparently reroute an invocation.
contextBridge.exposeInMainWorld('fixora', Object.freeze(bridge));
