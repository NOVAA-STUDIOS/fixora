import { useEffect } from 'react';

import { useUiStore } from '../stores/ui-store.js';

/**
 * Reflects the theme and density from the store onto the document root, where the token layer
 * reads them (`:root[data-theme]`, `:root[data-density]`). This is the *single* place that writes
 * those attributes — the tokens do the rest in CSS, so the switch is instant and involves no
 * component re-render (the acceptance criterion "theme + density switch instantly with no layout
 * shift" is a property of this design, not of each component).
 *
 * No JS reads a colour value anywhere; nothing can drift from the tokens.
 */
export function useAppearance(): void {
  const theme = useUiStore((s) => s.theme);
  const density = useUiStore((s) => s.density);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  useEffect(() => {
    document.documentElement.setAttribute('data-density', density);
  }, [density]);
}
