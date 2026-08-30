import { useEffect, useRef, useState } from 'react';

import { invoke } from '../../lib/bridge.js';

import type { SplashPhase } from './splash-screen.js';

/**
 * Splash timing. One rule: never hide it before `SPLASH_MIN_VISIBLE_MS` has elapsed, so the
 * entrance animation always gets to finish — and never hold it open a moment longer than that
 * once initialization has actually resolved. No timeout, no error state: initialization either
 * finishes (this simply waits for it) or the app never got this far to begin with.
 */
export const SPLASH_MIN_VISIBLE_MS = 300;
export const SPLASH_FADE_MS = 300;
/** The splash shows for at least this long regardless of how fast `initialize` resolves — long
 *  enough to read as an intentional beat, not a flash, on a backend that is ready instantly. */
const MIN_SPLASH_MS = 2000;
/** Shorter beat right after an update install — the user already waited through the restart. */
const POST_UPDATE_MIN_SPLASH_MS = 500;
const LAST_SPLASH_VERSION_KEY = 'fixora.lastSplashVersion';

/** Whichever version last finished a splash, from `localStorage` — `null` on a fresh profile or
 *  a read failure, both treated as "not a post-update launch" by the caller. */
function resolveSplashTiming(): Promise<{ ms: number; version: string | null }> {
  return invoke('app:getReadyState', {})
    .then((ready) =>
      ready.ok ? invoke('system:getAppInfo', {}) : Promise.reject(new Error(ready.error.message)),
    )
    .then((info) => {
      if (!info.ok) return { ms: MIN_SPLASH_MS, version: null };
      const currentVersion = info.value.version;
      const lastVersion = localStorage.getItem(LAST_SPLASH_VERSION_KEY);
      const isPostUpdate = lastVersion !== null && lastVersion !== currentVersion;
      return { ms: isPostUpdate ? POST_UPDATE_MIN_SPLASH_MS : MIN_SPLASH_MS, version: currentVersion };
    })
    .catch(() => ({ ms: MIN_SPLASH_MS, version: null }));
}

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

    let resolvedVersion: string | null = null;
    const minSplashDelay = resolveSplashTiming().then(({ ms, version }) => {
      resolvedVersion = version;
      return new Promise((resolve) => {
        setTimeout(resolve, ms);
      });
    });

    // `initialize` now carries its own timeout (`waitForAppReady`'s 30s race) — a rejection means
    // `app:ready` genuinely never arrived, so this shows the error state instead of blindly
    // dismissing into a half-started app.
    Promise.all([initializeRef.current(), minSplashDelay]).then(() => {
      if (resolvedVersion !== null) {
        try {
          localStorage.setItem(LAST_SPLASH_VERSION_KEY, resolvedVersion);
        } catch {
          // Best-effort — a failed write just means the next launch falls back to MIN_SPLASH_MS.
        }
      }
      dismiss();
    }, (error: unknown) => {
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
