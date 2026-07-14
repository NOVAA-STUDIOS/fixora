import type {
  Channel,
  EventChannel,
  EventPayloadOf,
  RequestOf,
  ResponseOf,
  Result,
} from '@fixora/shared-types';

/**
 * The renderer's view of the world. It has exactly this, and it has it because the preload chose
 * to give it (invariant I2). There is no `window.require`, no `ipcRenderer`, no `fs`.
 */
type FixoraBridge = {
  invoke: <C extends Channel>(channel: C, request: RequestOf<C>) => Promise<Result<ResponseOf<C>>>;
  subscribe: <E extends EventChannel>(
    channel: E,
    listener: (payload: EventPayloadOf<E>) => void,
  ) => () => void;
};

declare global {
  interface Window {
    readonly fixora: FixoraBridge;
  }
}

export function invoke<C extends Channel>(
  channel: C,
  request: RequestOf<C>,
): Promise<Result<ResponseOf<C>>> {
  return window.fixora.invoke(channel, request);
}

/** Subscribe to a main→renderer event; returns an unsubscribe function. */
export function subscribe<E extends EventChannel>(
  channel: E,
  listener: (payload: EventPayloadOf<E>) => void,
): () => void {
  return window.fixora.subscribe(channel, listener);
}
