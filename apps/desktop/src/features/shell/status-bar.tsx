import { Button } from '@fixora/ui';

import { useUiStore } from '../../stores/ui-store.js';
import { useFindingsStore } from '../findings/findings-store.js';
import { useWorkspaceStore } from '../workspace/workspace-store.js';

/**
 * The status bar (Design Review §5) — the thin strip along the bottom. It answers "what am I looking
 * at?" without the user hunting: the open project, the analysis status, and the finding counts. It is
 * a `role="status"` region so analysis progress is announced to assistive tech.
 */
export function StatusBar(): React.JSX.Element {
  const density = useUiStore((s) => s.density);
  const theme = useUiStore((s) => s.theme);
  const toggleDensity = useUiStore((s) => s.toggleDensity);
  const toggleTheme = useUiStore((s) => s.toggleTheme);

  const workspace = useWorkspaceStore((s) => s.workspace);
  const summary = useFindingsStore((s) => s.summary);
  const status = useFindingsStore((s) => s.status);

  const analysis =
    status === 'running'
      ? 'Analyzing…'
      : summary === null
        ? 'Not analyzed yet'
        : summary.total === 0
          ? 'No problems'
          : `${String(summary.total)} problem${summary.total === 1 ? '' : 's'}`;

  return (
    <footer
      role="status"
      className="flex h-6 shrink-0 items-center justify-between gap-3 border-t border-border-subtle bg-canvas px-3 text-xs text-fg-muted select-none"
    >
      <div className="flex min-w-0 items-center gap-2">
        <span className="truncate" title={workspace?.rootPath ?? undefined}>
          {workspace === null ? 'No folder open' : workspace.name}
        </span>
        {workspace !== null && (
          <>
            <span aria-hidden="true" className="text-border-strong">
              ·
            </span>
            <span className="shrink-0">{analysis}</span>
          </>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1">
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
