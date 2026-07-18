import { useCallback, useEffect, useRef, useState } from 'react';

import type { SplashPhase } from './splash-screen.js';

/**
 * Splash timing.
 *
 * Three rules, in priority order:
 *
 * 1. **Never hide it while initialization is still running.** The floor is a minimum, not a
 *    schedule: if hydration takes six seconds the splash stays up for six seconds.
 * 2. **Never hold it once initialization is done and the floor has passed.** The floor exists so the
 *    screen can be read, not to perform slowness.
 * 3. **Never strand the user.** A failure shows an error with a retry and a way past it, immediately
 *    rather than after the floor — an error is not something to make someone wait for.
 *
 * Initialization is a promise started by the caller as the app mounts; it runs while the splash is
 * painted. Nothing here blocks it, and nothing here runs on a timer the work has to wait for.
 */

/** Long enough to read the name, tagline and status line without feeling detained. */
export const SPLASH_MIN_VISIBLE_MS = 3500;
/** Matches the CSS transition on the splash container. */
export const SPLASH_FADE_MS = 300;
/**
 * The floor after a retry. The user is now actively waiting on something they asked for, so the
 * full first-run floor would be an imposition — this is just enough to avoid a flash.
 */
export const SPLASH_RETRY_MIN_MS = 400;

export type SplashState =
  | { visible: true; phase: SplashPhase; message: string; errorMessage: string | null }
  | { visible: false };

export function useSplash(initialize: () => Promise<unknown>): {
  state: SplashState;
  retry: () => void;
  dismiss: () => void;
} {
  const [phase, setPhase] = useState<SplashPhase | 'done'>('entering');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Held in refs so `run` can be a stable callback: re-creating it would restart initialization.
  const cancelled = useRef(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const initializeRef = useRef(initialize);
  initializeRef.current = initialize;

  const later = useCallback((fn: () => void, ms: number) => {
    timers.current.push(setTimeout(fn, ms));
  }, []);

  const run = useCallback(
    (floorMs: number) => {
      const startedAt = Date.now();
      setErrorMessage(null);
      // A frame at opacity-0 before flipping to opacity-100 is what gives us a fade *in* rather than
      // an abrupt paint — the element has to be mounted at the initial opacity for the transition to
      // have something to animate from.
      setPhase('entering');
      later(() => {
        if (!cancelled.current) setPhase('loading');
      }, 30);

      void initializeRef.current().then(
        () => {
          if (cancelled.current) return;
          // Rule 1 and 2: whichever of "work finished" and "floor elapsed" is later.
          const remaining = Math.max(0, floorMs - (Date.now() - startedAt));
          later(() => {
            if (cancelled.current) return;
            setPhase('leaving');
            later(() => {
              if (!cancelled.current) setPhase('done');
            }, SPLASH_FADE_MS);
          }, remaining);
        },
        (error: unknown) => {
          if (cancelled.current) return;
          setErrorMessage(
            error instanceof Error && error.message !== ''
              ? error.message
              : 'Fixora could not finish starting up.',
          );
          // Rule 3: surface it now, not after the floor. The short delay only lets the fade-in
          // finish, so the error does not pop in mid-transition.
          const sinceStart = Date.now() - startedAt;
          later(
            () => {
              if (!cancelled.current) setPhase('error');
            },
            Math.max(0, SPLASH_FADE_MS - sinceStart),
          );
        },
      );
    },
    [later],
  );

  useEffect(() => {
    cancelled.current = false;
    run(SPLASH_MIN_VISIBLE_MS);
    const pending = timers.current;
    return () => {
      cancelled.current = true;
      for (const t of pending) clearTimeout(t);
      pending.length = 0;
    };
  }, [run]);

  const retry = useCallback(() => {
    for (const t of timers.current) clearTimeout(t);
    timers.current.length = 0;
    run(SPLASH_RETRY_MIN_MS);
  }, [run]);

  const dismiss = useCallback(() => {
    setPhase('leaving');
    later(() => {
      if (!cancelled.current) setPhase('done');
    }, SPLASH_FADE_MS);
  }, [later]);

  const state: SplashState =
    phase === 'done'
      ? { visible: false }
      : {
          visible: true,
          phase,
          message: 'Restoring your workspace…',
          errorMessage,
        };

  return { state, retry, dismiss };
}
