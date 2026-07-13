import type { ThemeName } from '@fixora/tokens';
import { useCallback, useState } from 'react';

/**
 * Theme is a UI fact the user clicked, so it belongs to the client-state owner (ADR-015).
 * In M0 it lives in component state; in M2 it moves to a Zustand slice backed by SQLite,
 * which is where "must survive a restart" facts live. It does not get mirrored into both.
 *
 * The DOM attribute is the single mechanism: `:root[data-theme]` overrides the
 * `prefers-color-scheme` default that @fixora/tokens already emits, so an unset theme
 * follows the OS and a set one wins. No JS reads a colour value; nothing can drift.
 */
export function useTheme(): { theme: ThemeName; toggle: () => void } {
  const [theme, setTheme] = useState<ThemeName>(() => readInitialTheme());

  const toggle = useCallback(() => {
    setTheme((current) => {
      const next: ThemeName = current === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      return next;
    });
  }, []);

  return { theme, toggle };
}

function readInitialTheme(): ThemeName {
  const attribute = document.documentElement.getAttribute('data-theme');
  if (attribute === 'light' || attribute === 'dark') {
    return attribute;
  }
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}
