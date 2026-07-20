import { Button, FixoraMark, FolderIcon, Kbd } from '@fixora/ui';

import { useUiStore } from '../../stores/ui-store.js';
import { useWorkspaceStore } from '../workspace/workspace-store.js';

import { RecentProjects } from './recent-projects.js';

/**
 * The Home screen: what Fixora shows when no project is open.
 *
 * It replaces what used to happen at launch — three panes each rendering their own empty state
 * ("Open a project", "No file open", "Ready to repair") side by side. Three simultaneous "there is
 * nothing here" messages is not a welcome; it is an apology repeated three times, and it made the
 * product's first impression a mostly-empty three-column grid with no obvious next action.
 *
 * So the whole workbench becomes one surface with one job: open a project. Every editor that gets
 * this right does the same thing — VS Code's Welcome tab, Cursor's start screen, a Raycast root
 * view. One focal point, the primary action at the centre of it, and recent work as real rows you
 * can identify (path and when you last touched it) rather than a list of bare folder names.
 */
export function HomeScreen(): React.JSX.Element {
  const pickAndOpen = useWorkspaceStore((s) => s.pickAndOpen);
  const opening = useWorkspaceStore((s) => s.opening);
  const error = useWorkspaceStore((s) => s.error);
  const togglePalette = useUiStore((s) => s.togglePalette);

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-y-auto rounded-lg border border-border-subtle bg-raised">
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center gap-10 px-8 py-12">
        <header className="flex flex-col items-center gap-4 text-center">
          <FixoraMark className="size-14 drop-shadow-lg" title="Fixora" />
          <div className="flex flex-col gap-1.5">
            <h1 className="text-2xl font-semibold tracking-tight text-fg">Fixora</h1>
            {/* One sentence that says what the product is for, at a size you actually read —
                the old copy said the same thing at 12px inside a 220px column. */}
            <p className="text-md text-fg-secondary">
              The workspace you open when the code is already broken.
            </p>
          </div>
          <div className="mt-1 flex flex-wrap items-center justify-center gap-2">
            <Button
              variant="primary"
              size="lg"
              className="min-w-44 shadow-md"
              onClick={() => void pickAndOpen()}
              disabled={opening}
            >
              <FolderIcon className="size-4" />
              {opening ? 'Opening…' : 'Open folder'}
            </Button>
          </div>
          <p className="flex items-center gap-1.5 text-xs text-fg-muted">
            or press <Kbd>Ctrl</Kbd>
            <Kbd>K</Kbd> for commands
          </p>
          {error !== null && (
            <p role="alert" className="max-w-md text-xs text-danger-text [overflow-wrap:anywhere]">
              {error}
            </p>
          )}
        </header>

        <RecentProjects />

        <footer className="flex items-center justify-center gap-2 text-xs text-fg-muted">
          <span>
            Analysis runs locally. Your code never leaves this machine unless you ask it to.
          </span>
          <button
            type="button"
            onClick={togglePalette}
            className="rounded px-1.5 py-0.5 text-accent-text transition-colors duration-(--fx-motion-duration-fast) hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus-ring focus-visible:outline"
          >
            Browse commands
          </button>
        </footer>
      </div>
    </div>
  );
}
