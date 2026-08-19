import { subscribe } from './bridge.js';

/**
 * Resolves once main has finished constructing every service and registering every IPC handler
 * (`app:ready`, emitted at the end of `startBackend` in `electron/main/index.ts`). Main now
 * creates the window and starts loading the renderer BEFORE that setup runs — a real DB migration
 * or a slow disk no longer holds up the window itself — so anything that needs a real IPC round
 * trip has to wait for this instead of assuming main is already listening.
 *
 * A single shared promise, not one per caller: every caller in one renderer session is waiting for
 * the same one-time event.
 */
let readyPromise: Promise<void> | null = null;

export function waitForAppReady(): Promise<void> {
  readyPromise ??= new Promise((resolve) => {
    // Boxed rather than a plain `const unsubscribe = subscribe(...)`: `subscribe`'s real
    // implementation only ever calls back later, but nothing guarantees that of every
    // implementation it might have (a test double, for instance) — a listener that fires
    // SYNCHRONOUSLY, before `subscribe` has returned, would read `unsubscribe` before it was ever
    // assigned. A `const` read at that point throws (TDZ), and a throw inside a Promise executor
    // silently rejects the promise instead of resolving it — `waitForAppReady` would never resolve
    // at all. The box itself (`ref`) is assigned exactly once, so it can stay `const`; only its
    // property is written after the fact, which is what actually needs the flexibility.
    const ref: { unsubscribe: (() => void) | null } = { unsubscribe: null };
    ref.unsubscribe = subscribe('app:ready', () => {
      ref.unsubscribe?.();
      resolve();
    });
  });
  return readyPromise;
}
