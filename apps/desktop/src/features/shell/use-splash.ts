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
/** Safety fallback: if `app:ready` never fires (a stuck main process), the app is still usable
 *  underneath — don't leave the user staring at the splash forever. */
export const SPLASH_FALLBACK_MS = 5_000;

export type SplashState = { visible: true; phase: SplashPhase } | { visible: false };

export function useSplash(initialize: () => Promise<unknown>): SplashState {
  const [phase, setPhase] = useState<SplashPhase | 'done'>('entering');
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

    void initializeRef.current().finally(dismiss);
    const fallback = setTimeout(dismiss, SPLASH_FALLBACK_MS);

    return () => {
      cancelled.current = true;
      clearTimeout(enter);
      clearTimeout(fallback);
    };
  }, []);

  return phase === 'done' ? { visible: false } : { visible: true, phase };
}
