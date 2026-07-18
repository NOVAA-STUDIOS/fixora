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

/**
 * The status line, in the order startup actually reaches them.
 *
 * Each message corresponds to real work: index 0 is "we have started", 1 is "the workspace query
 * came back", 2 is "its files are listed". There is deliberately no "Preparing AI engine" — nothing
 * about the AI provider is initialized at launch (the BYOK config is read lazily when the assistant
 * panel first mounts), and narrating a step the app does not take is the kind of small lie that
 * makes a user right not to trust the rest of the screen.
 *
 * `Ready` is index 3 and is shown **only** once initialization has genuinely resolved.
 */
export const SPLASH_MESSAGES = [
  'Initializing Fixora…',
  'Loading workspace…',
  'Preparing editor…',
  'Ready',
] as const;

/**
 * How long each message is held *at minimum*, so a step that completes in 20ms is still readable.
 *
 * This paces the display; it never runs ahead of the work. The message shown is the *lesser* of "how
 * far the work has actually got" and "how far the clock allows" — so a stage is never announced
 * before it has happened, and a fast startup does not strobe through four strings in one frame.
 */
export const SPLASH_MESSAGE_HOLD_MS = 850;

export type SplashState =
  | { visible: true; phase: SplashPhase; message: string; errorMessage: string | null }
  | { visible: false };

export function useSplash(initialize: (onStage?: (stage: string) => void) => Promise<unknown>): {
  state: SplashState;
  retry: () => void;
  dismiss: () => void;
} {
  const [phase, setPhase] = useState<SplashPhase | 'done'>('entering');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  /** How far the *work* has got: 0 started, 1 workspace resolved, 2 files listed, 3 fully done. */
  const [reached, setReached] = useState(0);
  /** How far the *clock* permits showing, so fast steps stay readable. Never exceeds `reached`. */
  const [allowed, setAllowed] = useState(0);

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
      setReached(0);
      setAllowed(0);
      // The clock's permission to advance. It only ever *allows* a message; whether one is shown
      // still depends on the work having reached it.
      for (let step = 1; step < SPLASH_MESSAGES.length; step += 1) {
        later(() => {
          if (!cancelled.current) setAllowed(step);
        }, SPLASH_MESSAGE_HOLD_MS * step);
      }
      // A frame at opacity-0 before flipping to opacity-100 is what gives us a fade *in* rather than
      // an abrupt paint — the element has to be mounted at the initial opacity for the transition to
      // have something to animate from.
      setPhase('entering');
      later(() => {
        if (!cancelled.current) setPhase('loading');
      }, 30);

      void initializeRef
        .current((stage) => {
          if (cancelled.current) return;
          // A stage report only ever moves this forward, and only to the step it names.
          setReached((current) => Math.max(current, stage === 'workspace' ? 1 : 2));
        })
        .then(
          () => {
            if (cancelled.current) return;
            // "Ready" is gated on the promise actually resolving — never on the clock. This is the
            // one message that claims completion, so it is the one that must never be predicted.
            setReached(SPLASH_MESSAGES.length - 1);
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

  // The whole honesty rule in one expression: never ahead of the work, never faster than readable.
  const messageIndex = Math.min(reached, allowed, SPLASH_MESSAGES.length - 1);

  const state: SplashState =
    phase === 'done'
      ? { visible: false }
      : {
          visible: true,
          phase,
          message: SPLASH_MESSAGES[messageIndex] ?? SPLASH_MESSAGES[0],
          errorMessage,
        };

  return { state, retry, dismiss };
}
