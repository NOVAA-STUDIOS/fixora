import { useCallback, useEffect, useRef, useState } from 'react';

import type { SplashPhase } from './splash-screen.js';

/**
 * Splash timing (Sprint F2: Welcome Experience; adjusted after F2 shipped with no floor at all;
 * hardened after the A1 beta-readiness audit with a hang safety net).
 *
 * Three rules, in priority order:
 *
 * 1. **Never hide it while initialization is still running.** The floor below is a minimum, not a
 *    schedule: if hydration takes six seconds the splash stays up for six seconds.
 * 2. **Never hold it open for its own sake.** The floor exists for exactly one reason — so the
 *    staggered logo/wordmark/tagline entrance animation gets to finish playing instead of being cut
 *    off mid-motion — and for nothing else. It is bounded at `SPLASH_MIN_VISIBLE_MS`, comfortably
 *    inside the ~1.5–2.5s the entrance animation itself takes to complete (the last element starts
 *    animating at 900ms and takes 420ms — call it ~1.3s), never a multi-second "let it feel
 *    premium" wait manufactured on top of that.
 * 3. **Never strand the user.** A failure shows an error with a retry and a way past it, immediately
 *    — an error is not something to make someone wait for. This includes initialization that never
 *    settles at all: `SPLASH_HANG_TIMEOUT_MS` is a safety net, not a schedule — real completion
 *    still wins if it arrives late (a stale attempt's own success/failure is ignored once a retry
 *    has started a newer one, via the attempt-id guard below), and the net never fires at all on the
 *    overwhelmingly common path where initialization settles normally.
 *
 * Initialization is a promise started by the caller as the app mounts; it runs while the splash is
 * painted. Nothing here blocks it, and nothing here runs on a timer the work has to wait for beyond
 * that bounded animation-completion floor.
 */

/** Long enough for the entrance animation to finish; never a manufactured "premium" delay on top. */
export const SPLASH_MIN_VISIBLE_MS = 1800;
/** Matches the CSS transition on the splash container — the closing animation, not a wait. */
export const SPLASH_FADE_MS = 300;
/**
 * The floor after a retry. The entrance replays, but the user has already seen the brand once and is
 * now actively waiting on something they asked for — the full first-run floor would be an imposition.
 */
export const SPLASH_RETRY_MIN_MS = 900;
/**
 * A safety net for initialization that never settles — a stalled DB open, a wedged IPC round-trip.
 * Without this, that failure mode is indistinguishable from "still loading": an infinite spinner with
 * no error, no retry, no way out. This is deliberately generous (real startup is two round-trips that
 * finish in well under a second) so it never fires on a genuinely slow but working machine.
 */
export const SPLASH_HANG_TIMEOUT_MS = 30_000;

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
 * This paces the display; it never delays closing beyond the animation-completion floor above. The
 * message shown is the *lesser* of "how far the work has actually got" and "how far the clock
 * allows" — so a stage is never announced before it has happened, and a fast startup does not strobe
 * through four strings in one frame.
 */
export const SPLASH_MESSAGE_HOLD_MS = 850;

export type SplashState =
  | {
      visible: true;
      phase: SplashPhase;
      message: string;
      /** Whether initialization is genuinely still running — gates the loading indicator itself
       *  (req. 5): once work resolves, the indicator disappears immediately even if the splash is
       *  still up waiting out the entrance-animation floor. */
      working: boolean;
      errorMessage: string | null;
    }
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
  /** Bumped on every `run()` call so a stale attempt's own promise/timers can recognise they have
   *  been superseded — needed because a retry can now start while the previous attempt's real
   *  `initialize()` promise is still pending (the hang timeout can show an error before the real
   *  promise ever settles), which the original design never had to account for. */
  const attemptId = useRef(0);

  const later = useCallback((fn: () => void, ms: number) => {
    timers.current.push(setTimeout(fn, ms));
  }, []);

  const run = useCallback(
    (floorMs: number) => {
      const myAttempt = (attemptId.current += 1);
      const isStale = () => cancelled.current || attemptId.current !== myAttempt;
      /** Whether *this* attempt has already reached a terminal outcome (success, failure, or hang
       *  timeout) — separate from `isStale`, which is about a *newer* attempt superseding this one. */
      let settled = false;

      const startedAt = Date.now();
      setErrorMessage(null);
      setReached(0);
      setAllowed(0);
      // The clock's permission to advance. It only ever *allows* a message; whether one is shown
      // still depends on the work having reached it. These timers pace display only.
      for (let step = 1; step < SPLASH_MESSAGES.length; step += 1) {
        later(() => {
          if (!isStale()) setAllowed(step);
        }, SPLASH_MESSAGE_HOLD_MS * step);
      }
      // A frame at opacity-0 before flipping to opacity-100 is what gives us a fade *in* rather than
      // an abrupt paint — the element has to be mounted at the initial opacity for the transition to
      // have something to animate from.
      setPhase('entering');
      later(() => {
        // Guarded with a functional update, not just `isStale`: initialization can resolve or
        // reject before this fires, and a terminal phase must never be stomped back to 'loading' by
        // a stale entrance-transition timer.
        if (!isStale()) setPhase((current) => (current === 'entering' ? 'loading' : current));
      }, 30);

      // The hang safety net (rule 3). Cleared implicitly by the `settled`/`isStale` guards below if
      // the real promise gets there first — it only ever does something on the path where nothing
      // else would have.
      later(() => {
        if (isStale() || settled) return;
        settled = true;
        setErrorMessage(
          'Fixora is taking longer than expected to start. You can keep waiting or try again.',
        );
        setPhase('error');
      }, SPLASH_HANG_TIMEOUT_MS);

      void initializeRef
        .current((stage) => {
          if (isStale()) return;
          // A stage report only ever moves this forward, and only to the step it names.
          setReached((current) => Math.max(current, stage === 'workspace' ? 1 : 2));
        })
        .then(
          () => {
            if (isStale() || settled) return;
            settled = true;
            // "Ready" is gated on the promise actually resolving — never on the clock. This is the
            // one message that claims completion, so it is the one that must never be predicted.
            setReached(SPLASH_MESSAGES.length - 1);
            // Rule 1 and 2: whichever of "work finished" and "the entrance animation had time to
            // finish" is later — never longer than that.
            const remaining = Math.max(0, floorMs - (Date.now() - startedAt));
            later(() => {
              if (isStale()) return;
              setPhase('leaving');
              later(() => {
                if (!isStale()) setPhase('done');
              }, SPLASH_FADE_MS);
            }, remaining);
          },
          (error: unknown) => {
            if (isStale() || settled) return;
            settled = true;
            setErrorMessage(
              error instanceof Error && error.message !== ''
                ? error.message
                : 'Fixora could not finish starting up.',
            );
            // Rule 3: surface it now, not after the floor. An error is not something to wait for.
            setPhase('error');
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
  const working = reached < SPLASH_MESSAGES.length - 1;

  const state: SplashState =
    phase === 'done'
      ? { visible: false }
      : {
          visible: true,
          phase,
          message: SPLASH_MESSAGES[messageIndex] ?? SPLASH_MESSAGES[0],
          working,
          errorMessage,
        };

  return { state, retry, dismiss };
}
