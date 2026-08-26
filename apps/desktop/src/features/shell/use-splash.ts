import { useEffect, useRef, useState } from 'react';

import type { SplashPhase } from './splash-screen.js';

/**
 * Splash timing. One rule: never hide it before `SPLASH_MIN_VISIBLE_MS` has elapsed, so the
 * entrance animation always gets to finish — and never hold it open a moment longer than that
 * once initialization has actually resolved. No timeout, no error state: initialization either
 * finishes (this simply waits for it) or the app never got this far to begin with.
 */
export const SPLASH_MIN_VISIBLE_MS = 300;
export const SPLASH_FADE_MS = 300;

export type SplashState =
  | { visible: true; phase: SplashPhase; errorMessage?: string }
  | { visible: false };

export function useSplash(initialize: () => Promise<unknown>): SplashState {
  const [phase, setPhase] = useState<SplashPhase | 'done'>('entering');
  const [errorMessage, setErrorMessage] = useState<string | undefined>(undefined);
  const cancelled = useRef(false);
  const initializeRef = useRef(initialize);
  initializeRef.current = initialize;

  useEffect(() => {
    cancelled.current = false;
    const startedAt = Date.now();
    const enter = setTimeout(() => {
      if (!cancelled.current) setPhase('loading');
    }, 30);

    let dismissed = false;
    const dismiss = (): void => {
      if (cancelled.current || dismissed) return;
      dismissed = true;
      const remaining = Math.max(0, SPLASH_MIN_VISIBLE_MS - (Date.now() - startedAt));
      setTimeout(() => {
        if (cancelled.current) return;
        setPhase('leaving');
        setTimeout(() => {
          if (!cancelled.current) setPhase('done');
        }, SPLASH_FADE_MS);
      }, remaining);
    };

    // `initialize` now carries its own timeout (`waitForAppReady`'s 30s race) — a rejection means
    // `app:ready` genuinely never arrived, so this shows the error state instead of blindly
    // dismissing into a half-started app.
    initializeRef.current().then(dismiss, (error: unknown) => {
      if (cancelled.current) return;
      setErrorMessage(error instanceof Error ? error.message : String(error));
      setPhase('error');
    });

    return () => {
      cancelled.current = true;
      clearTimeout(enter);
    };
  }, []);

  if (phase === 'done') return { visible: false };
  return errorMessage !== undefined
    ? { visible: true, phase, errorMessage }
    : { visible: true, phase };
}
