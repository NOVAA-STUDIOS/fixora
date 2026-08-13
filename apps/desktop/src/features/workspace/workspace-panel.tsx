import type { WorkspaceInfo } from '@fixora/shared-types';
import { Button, ChevronDownIcon, FolderIcon, PlusIcon, WinCloseIcon, cn } from '@fixora/ui';
import { useEffect, useRef, useState } from 'react';

import { invoke } from '../../lib/bridge.js';
import { dirname } from '../../lib/path.js';

import { useFileActions } from './file-context-menu.js';
import { FileTree } from './file-tree.js';
import { useWorkspaceStore } from './workspace-store.js';

/**
 * The primary panel's workspace surface. With no workspace open it offers a big "Open folder" and the
 * recent list; once a folder is open, the header keeps an always-available Open menu so the user can
 * switch projects at any time — never trapped in the folder they first opened. Opening a folder touches
 * no network at all (FR-1).
 */
export function WorkspacePanel(): React.JSX.Element {
  const workspace = useWorkspaceStore((s) => s.workspace);
  const opening = useWorkspaceStore((s) => s.opening);
  const error = useWorkspaceStore((s) => s.error);
  const pickAndOpen = useWorkspaceStore((s) => s.pickAndOpen);
  const reopenLast = useWorkspaceStore((s) => s.reopenLast);

  if (workspace !== null) {
    return (
      <section
        aria-label="Workspace"
        className="flex h-full min-w-0 flex-col overflow-hidden rounded-lg border border-border-subtle bg-raised"
      >
        <header className="flex h-9 shrink-0 items-center gap-1.5 border-b border-border-subtle px-2">
          <FolderIcon className="size-4 shrink-0 text-fg-muted" />
          <h2
            className="min-w-0 flex-1 truncate text-[11px] font-semibold uppercase tracking-wider text-fg-secondary"
            title={workspace.rootPath}
          >
            {workspace.name}
          </h2>
          <NewAtRootButton />
          <OpenMenu />
        </header>
        <div className="min-h-0 min-w-0 flex-1">
          <FileTree />
        </div>
      </section>
    );
  }

  return (
    <section
      aria-label="Workspace"
      className="flex h-full min-w-0 flex-col items-center justify-center gap-4 overflow-hidden rounded-lg border border-border-subtle bg-raised p-6 text-center"
    >
      <div className="flex flex-col items-center gap-1">
        <FolderIcon className="size-8 text-fg-muted" />
        <h2 className="text-sm font-semibold text-fg">Open a project to get started</h2>
        <p className="max-w-xs text-xs text-fg-muted">
          Fixora reads and analyzes your code locally — offline, no sign-in. Open a folder, then run
          analysis.
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button
          variant="primary"
          className="shrink-0"
          onClick={() => void pickAndOpen()}
          disabled={opening}
        >
          {opening ? 'Opening…' : 'Open folder'}
        </Button>
        {/* Only offered when there is actually something to reopen — a button that does nothing is
            worse than no button. */}
        <RecentWorkspaces
          render={(recent) =>
            recent.length === 0 ? null : (
              <Button
                variant="ghost"
                // The label carries a project name of unknown length, so it is capped and truncated
                // rather than allowed to set the width of the empty state.
                className="max-w-full min-w-0 truncate"
                onClick={() => void reopenLast()}
                disabled={opening}
              >
                Reopen {recent[0]?.name ?? 'last project'}
              </Button>
            )
          }
        />
      </div>
      {error !== null && (
        <p role="alert" className="max-w-xs text-xs text-danger-text">
          {error}
        </p>
      )}
      <RecentWorkspaces
        render={(recent, openPath) =>
          recent.length === 0 ? null : (
            <div className="flex w-full max-w-xs flex-col gap-1">
              <p className="text-xs font-medium text-fg-muted">Recent</p>
              {recent.map((w) => (
                <Button
                  key={w.id}
                  variant="ghost"
                  size="sm"
                  className="w-full min-w-0 justify-start truncate"
                  title={w.rootPath}
                  onClick={() => void openPath(w.rootPath)}
                >
                  {w.name}
                </Button>
              ))}
            </div>
          )
        }
      />
    </section>
  );
}

/**
 * The always-available "switch project" control in the open-workspace header.
 *
 * Neither "Open folder…", "Close folder", nor a "Recent" entry here checks for unsaved edits
 * itself — `close()`/`openPath()` in the store do that centrally (via `pendingAction` and the one
 * shared `WorkspaceSwitchGuard` dialog mounted in `AppShell`), so this menu cannot forget the
 * check the way it once could (beta audit A2).
 */
/**
 * The "+" button — New File/New Folder, targeted at the current tree selection.
 *
 * It used to be hardcoded to the workspace root, which meant a user who had just clicked the
 * folder they were working in still got their new file at the top level and had to move it. The
 * target now follows the selection (`newEntryDir()`: inside a selected folder, alongside a selected
 * file, root when nothing is selected) and the button's tooltip names it, so the destination is
 * visible before the click rather than discovered after it. Right-clicking a row in the tree opens
 * the same menu scoped to that row instead (`file-context-menu.tsx`).
 */
function NewAtRootButton(): React.JSX.Element {
  const { openMenu, menu } = useFileActions();
  // Derived from the subscribed selection rather than read through `getState()`, so the label
  // re-renders as the selection moves. Same rule as the store's `newEntryDir()`.
  const selectedDir = useWorkspaceStore((s) => s.selectedDir);
  const selectedFile = useWorkspaceStore((s) => s.selectedFile);
  const targetDir = selectedDir ?? (selectedFile === null ? '' : dirname(selectedFile));
  return (
    <>
      <button
        type="button"
        aria-label={
          targetDir === '' ? 'New file or folder' : `New file or folder in ${targetDir}`
        }
        title={
          targetDir === ''
            ? 'New file or folder (at project root)'
            : `New file or folder in ${targetDir}`
        }
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          openMenu(
            targetDir === '' ? { relPath: '', kind: 'root' } : { relPath: targetDir, kind: 'dir' },
            rect.left,
            rect.bottom + 4,
          );
        }}
        className="flex items-center rounded p-1 text-fg-secondary hover:bg-hover hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus-ring focus-visible:outline"
      >
        <PlusIcon className="size-3.5" />
      </button>
      {menu}
    </>
  );
}

function OpenMenu(): React.JSX.Element {
  const pickAndOpen = useWorkspaceStore((s) => s.pickAndOpen);
  const openPath = useWorkspaceStore((s) => s.openPath);
  const current = useWorkspaceStore((s) => s.workspace);
  const close = useWorkspaceStore((s) => s.close);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          setOpen((v) => !v);
        }}
        className="flex items-center gap-0.5 rounded px-1.5 py-1 text-xs text-fg-secondary hover:bg-hover hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus-ring focus-visible:outline"
        title="Open or switch project"
      >
        Open
        <ChevronDownIcon className="size-3" />
      </button>
      {open && (
        <>
          <button
            type="button"
            aria-hidden="true"
            tabIndex={-1}
            className="fixed inset-0 z-10 cursor-default"
            onClick={() => {
              setOpen(false);
            }}
          />
          <div
            role="menu"
            // max-w clamps the menu to the pane at its 220px minimum, where a fixed 224px popup
            // would otherwise hang over the editor's left edge.
            className="absolute right-0 top-full z-20 mt-1 w-56 max-w-[calc(100vw-2rem)] rounded-md border border-border-subtle bg-canvas p-1 shadow-lg"
          >
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                void pickAndOpen();
              }}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-fg hover:bg-hover"
            >
              <FolderIcon className="size-3.5 text-fg-muted" />
              Open folder…
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                void close();
              }}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-fg hover:bg-hover"
            >
              <WinCloseIcon className="size-3.5 text-fg-muted" />
              Close folder
            </button>
            <RecentWorkspaces
              render={(recent) =>
                recent.filter((w) => w.rootPath !== current?.rootPath).length === 0 ? null : (
                  <div className="mt-1 border-t border-border-subtle pt-1">
                    <p className="px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-fg-muted">
                      Recent
                    </p>
                    {recent
                      .filter((w) => w.rootPath !== current?.rootPath)
                      .slice(0, 6)
                      .map((w) => (
                        <button
                          key={w.id}
                          type="button"
                          role="menuitem"
                          title={w.rootPath}
                          onClick={() => {
                            setOpen(false);
                            void openPath(w.rootPath);
                          }}
                          className={cn(
                            'flex w-full items-center rounded px-2 py-1.5 text-left text-xs text-fg-secondary hover:bg-hover hover:text-fg',
                          )}
                        >
                          <span className="truncate">{w.name}</span>
                        </button>
                      ))}
                  </div>
                )
              }
            />
          </div>
        </>
      )}
    </div>
  );
}

/** Fetches the recent workspaces once and hands them to `render`. */
function RecentWorkspaces({
  render,
}: {
  render: (recent: WorkspaceInfo[], openPath: (path: string) => Promise<void>) => React.ReactNode;
}): React.JSX.Element | null {
  const openPath = useWorkspaceStore((s) => s.openPath);
  const [recent, setRecent] = useState<WorkspaceInfo[]>([]);

  useEffect(() => {
    let cancelled = false;
    void invoke('workspace:recent', {}).then((result) => {
      if (!cancelled && result.ok) setRecent(result.value.workspaces);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return <>{render(recent, openPath)}</>;
}
