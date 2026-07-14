import { Button } from '@fixora/ui';

import { useUiStore } from '../../stores/ui-store.js';

/**
 * The status bar (Design Review §5) — the thin strip along the bottom. In M1 it shows the active
 * view and the density/theme controls; from M3 it will carry the finding counts and the analysis
 * status. It is a `role="status"` region so future live updates (analysis progress) are announced.
 */
export function StatusBar(): React.JSX.Element {
  const activeView = useUiStore((s) => s.activeView);
  const density = useUiStore((s) => s.density);
  const theme = useUiStore((s) => s.theme);
  const toggleDensity = useUiStore((s) => s.toggleDensity);
  const toggleTheme = useUiStore((s) => s.toggleTheme);

  return (
    <footer
      role="status"
      className="flex h-6 shrink-0 items-center justify-between border-t border-border-subtle bg-canvas px-3 text-xs text-fg-muted select-none"
    >
      <span className="capitalize">{activeView}</span>
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          className="h-5 px-2 text-xs"
          onClick={toggleDensity}
          aria-label={`Density: ${density}. Switch density.`}
        >
          {density}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-5 px-2 text-xs"
          onClick={toggleTheme}
          aria-label={`Theme: ${theme}. Switch theme.`}
        >
          {theme}
        </Button>
      </div>
    </footer>
  );
}
