import type { WorkspaceInfo } from '@fixora/shared-types';
import { Button, FixoraMark, FolderIcon, Kbd, cn } from '@fixora/ui';
import { useEffect, useState } from 'react';

import { invoke } from '../../lib/bridge.js';
import { useUiStore } from '../../stores/ui-store.js';
import { useWorkspaceStore } from '../workspace/workspace-store.js';

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
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-y-auto bg-canvas">
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

/**
 * Recent projects as identifiable rows. A folder called `src` or `app` is ambiguous on its own —
 * the path is what tells you *which* one, and the timestamp is what tells you it is the one you
 * were in yesterday. That is the difference between a list you scan and a list you guess at.
 */
function RecentProjects(): React.JSX.Element | null {
  const openPath = useWorkspaceStore((s) => s.openPath);
  const opening = useWorkspaceStore((s) => s.opening);
  const [recent, setRecent] = useState<WorkspaceInfo[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void invoke('workspace:recent', {}).then((result) => {
      if (cancelled) return;
      setRecent(result.ok ? result.value.workspaces : []);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Skeletons rather than a blank gap: the section keeps its height, so the primary action above
  // does not jump upward the moment the list resolves.
  if (recent === null) {
    return (
      <section className="flex flex-col gap-2" aria-busy="true" aria-label="Recent projects">
        <SectionLabel>Recent</SectionLabel>
        <div className="grid gap-1.5 sm:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-14 animate-pulse rounded-lg border border-border-subtle bg-inset"
            />
          ))}
        </div>
      </section>
    );
  }

  if (recent.length === 0) return null;

  return (
    <section className="flex flex-col gap-2" aria-label="Recent projects">
      <SectionLabel>Recent</SectionLabel>
      <div className="grid gap-1.5 sm:grid-cols-2">
        {recent.slice(0, 6).map((w) => (
          <button
            key={w.id}
            type="button"
            disabled={opening}
            onClick={() => void openPath(w.rootPath)}
            title={w.rootPath}
            className={cn(
              'group flex min-w-0 items-center gap-3 rounded-lg border border-border-subtle bg-inset px-3 py-2.5 text-left',
              'transition-[background-color,border-color,transform] duration-(--fx-motion-duration-fast) ease-(--ease-entrance)',
              'hover:border-accent-border hover:bg-hover disabled:opacity-50',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring focus-visible:outline',
            )}
          >
            <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-raised text-fg-muted transition-colors duration-(--fx-motion-duration-fast) group-hover:text-accent-text">
              <FolderIcon className="size-4" />
            </span>
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-sm font-medium text-fg">{w.name}</span>
              {/* dir: the path reads right-to-left here — the tail is the identifying part. */}
              <span dir="rtl" className="truncate text-left text-xs text-fg-muted">
                {w.rootPath}
              </span>
            </span>
            <span className="ml-auto shrink-0 text-[11px] text-fg-muted tabular-nums">
              {relativeTime(w.lastOpenedAt)}
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <h2 className="px-1 text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
      {children}
    </h2>
  );
}

/** "2h", "3d" — short enough to sit in a row without competing with the project name. */
function relativeTime(ms: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${String(minutes)}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${String(hours)}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${String(days)}d ago`;
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
