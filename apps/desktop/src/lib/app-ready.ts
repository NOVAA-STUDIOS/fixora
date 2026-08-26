import { invoke } from './bridge.js';

/**
 * Resolves once main has finished constructing every service and registering every IPC handler.
 *
 * Pull, not push: this used to wait on an `app:ready` event main emitted once, which raced the
 * renderer's own subscribe — a listener attached even a moment after the emit missed it outright,
 * with nothing to recover it (30s timeout → error state). Polling `app:getReadyState` has no such
 * race: there is no listener to miss an emission, only a question asked repeatedly until the
 * answer is yes.
 *
 * A single shared promise, not one per caller: every caller in one renderer session is waiting for
 * the same one-time readiness.
 */
let readyPromise: Promise<void> | null = null;

const POLL_INTERVAL_MS = 100;
/** How long to wait for main before giving up — a stuck main process must not leave the splash
 *  spinning forever. */
const TIMEOUT_MS = 30_000;

export function waitForAppReady(): Promise<void> {
  if (readyPromise !== null) return readyPromise;
  readyPromise = new Promise<void>((resolve, reject) => {
    const start = Date.now();
    const poll = async (): Promise<void> => {
      try {
        const result = await invoke('app:getReadyState', {});
        if (result.ok && result.value.ready) {
          resolve();
          return;
        }
      } catch {
        // The channel itself throws only if the preload's allowlist rejects it, which cannot
        // happen here — kept broad so a transient IPC hiccup degrades to "keep polling" too.
      }
      if (Date.now() - start > TIMEOUT_MS) {
        reject(new Error('App took too long to start'));
        return;
      }
      setTimeout(() => void poll(), POLL_INTERVAL_MS);
    };
    void poll();
  });
  return readyPromise;
}
