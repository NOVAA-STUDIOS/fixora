import type { WorkspaceInfo } from '@fixora/shared-types';
import {
  CloseIcon,
  ConfirmDialog,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
  CopyIcon,
  ExternalIcon,
  FolderIcon,
  TrashIcon,
  cn,
} from '@fixora/ui';
import { useCallback, useEffect, useState } from 'react';

import { invoke } from '../../lib/bridge.js';
import { copyToClipboard } from '../../lib/clipboard.js';
import { useWorkspaceStore } from '../workspace/workspace-store.js';

/**
 * The recent-projects list on the Home screen.
 *
 * This is the list a desktop user manages, not just reads: projects accumulate, and the ones you
 * opened once by accident stay there forever unless you can remove them. So it behaves the way the
 * equivalent list does in VS Code — a hover-only ✕ on each row, a right-click menu with the
 * operations that belong to a path, and a Clear All behind a confirmation.
 *
 * The safety line matters more than any of it and is stated in the UI itself: removing an entry is
 * a *list* operation. It forgets a bookmark. It never touches the folder, and the confirmation says
 * so in as many words, because "Clear all recent projects" is a sentence that can reasonably be
 * misread as "delete my projects".
 */
export function RecentProjects(): React.JSX.Element | null {
  const openPath = useWorkspaceStore((s) => s.openPath);
  const opening = useWorkspaceStore((s) => s.opening);
  const [recent, setRecent] = useState<WorkspaceInfo[] | null>(null);
  const [removing, setRemoving] = useState<string[]>([]);
  const [confirmClear, setConfirmClear] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void invoke('workspace:recent', {}).then((r) => {
      if (!cancelled) setRecent(r.ok ? r.value.workspaces : []);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * Remove with an exit animation. The row is marked `removing` first, which plays a 160ms collapse,
   * and only then does the list actually drop it. Without that the row vanishes between frames and
   * the rows below jump up — the user cannot tell whether they removed the one they meant to.
   */
  const remove = useCallback((id: string) => {
    setRemoving((ids) => [...ids, id]);
    window.setTimeout(() => {
      void invoke('workspace:removeRecent', { id }).then((r) => {
        if (r.ok) setRecent(r.value.workspaces);
        setRemoving((ids) => ids.filter((x) => x !== id));
      });
    }, 160);
  }, []);

  const clearAll = useCallback(() => {
    void invoke('workspace:clearRecent', {}).then((r) => {
      if (r.ok) setRecent(r.value.workspaces);
    });
  }, []);

  if (recent === null) {
    return (
      <section className="flex flex-col gap-2.5" aria-busy="true" aria-label="Recent projects">
        <Header onClear={null} />
        <div className="grid gap-2 sm:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-[62px] animate-pulse rounded-xl border border-border-subtle bg-inset"
            />
          ))}
        </div>
      </section>
    );
  }

  if (recent.length === 0) {
    return (
      <section className="flex flex-col gap-2.5" aria-label="Recent projects">
        <Header onClear={null} />
        {/* An empty recents list is not an error and should not look like one. It states the one
            fact the user needs — this fills itself in — rather than an apology. */}
        <div className="flex flex-col items-center gap-1.5 rounded-xl border border-dashed border-border-subtle bg-inset/50 px-6 py-8 text-center">
          <FolderIcon className="size-5 text-fg-muted" />
          <p className="text-sm font-medium text-fg">No recent projects</p>
          <p className="max-w-sm text-xs leading-relaxed text-fg-muted">
            Projects you open appear here so you can jump back in with one click.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-2.5" aria-label="Recent projects">
      <Header
        onClear={() => {
          setConfirmClear(true);
        }}
      />
      <div className="grid gap-2 sm:grid-cols-2">
        {recent.slice(0, 6).map((w) => (
          <RecentCard
            key={w.id}
            workspace={w}
            busy={opening}
            leaving={removing.includes(w.id)}
            onOpen={() => void openPath(w.rootPath)}
            onRemove={() => {
              remove(w.id);
            }}
            onClearAll={() => {
              setConfirmClear(true);
            }}
          />
        ))}
      </div>

      <ConfirmDialog
        open={confirmClear}
        onOpenChange={setConfirmClear}
        title="Clear all recent projects?"
        description="This clears the list only. Your project folders and their files are not touched, and you can open any of them again from Open folder."
        confirmLabel="Clear all"
        onConfirm={clearAll}
      />
    </section>
  );
}

function Header({ onClear }: { onClear: (() => void) | null }): React.JSX.Element {
  return (
    <div className="flex items-center justify-between gap-3 px-0.5">
      <h2 className="text-[11px] font-semibold uppercase tracking-wider text-fg-muted">Recent</h2>
      {onClear !== null && (
        <button
          type="button"
          onClick={onClear}
          className="rounded px-1.5 py-0.5 text-[11px] text-fg-muted transition-colors duration-(--fx-motion-duration-fast) hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus-ring focus-visible:outline"
        >
          Clear all
        </button>
      )}
    </div>
  );
}

function RecentCard({
  workspace,
  busy,
  leaving,
  onOpen,
  onRemove,
  onClearAll,
}: {
  workspace: WorkspaceInfo;
  busy: boolean;
  leaving: boolean;
  onOpen: () => void;
  onRemove: () => void;
  onClearAll: () => void;
}): React.JSX.Element {
  const [copied, setCopied] = useState(false);

  const copyPath = (): void => {
    void copyToClipboard(workspace.rootPath, { label: 'Path copied' }).then((ok) => {
      if (!ok) return;
      setCopied(true);
      window.setTimeout(() => {
        setCopied(false);
      }, 1200);
    });
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          className={cn(
            'group/card relative min-w-0',
            'transition-[opacity,transform] duration-(--fx-motion-duration-normal) ease-(--ease-exit)',
            leaving && 'pointer-events-none scale-95 opacity-0',
          )}
        >
          <button
            type="button"
            disabled={busy}
            onClick={onOpen}
            title={workspace.rootPath}
            className={cn(
              'flex w-full min-w-0 items-center gap-3 rounded-xl border border-border-subtle bg-inset px-3 py-2.5 text-left',
              'transition-[background-color,border-color] duration-(--fx-motion-duration-fast) ease-(--ease-entrance)',
              'hover:border-accent-border hover:bg-hover disabled:opacity-50',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring focus-visible:outline',
            )}
          >
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-raised text-fg-muted transition-colors duration-(--fx-motion-duration-fast) group-hover/card:bg-accent-subtle group-hover/card:text-accent-text">
              <FolderIcon className="size-4" />
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="truncate text-sm font-medium text-fg">{workspace.name}</span>
              {/* The path is the identifier — two projects can share a name. It reads RTL so the
                  tail (the part that disambiguates) survives truncation instead of the drive letter. */}
              <span dir="rtl" className="truncate text-left text-[11px] text-fg-muted">
                {copied ? 'Path copied' : workspace.rootPath}
              </span>
            </span>
            {/* The timestamp yields its space to the ✕ on hover, rather than the two fighting for
                the same corner or the card growing a third column it only sometimes needs. */}
            <span className="shrink-0 text-[11px] tabular-nums text-fg-muted transition-opacity duration-(--fx-motion-duration-fast) group-hover/card:opacity-0">
              {relativeTime(workspace.lastOpenedAt)}
            </span>
          </button>

          <button
            type="button"
            // Hover-only, but always reachable by keyboard: `focus-visible` brings it back, so the
            // control is not mouse-exclusive.
            onClick={onRemove}
            aria-label={`Remove ${workspace.name} from recent projects`}
            title="Remove from recent (does not delete the folder)"
            className={cn(
              'absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md p-1.5',
              'text-fg-muted opacity-0 transition-[opacity,background-color,color] duration-(--fx-motion-duration-fast)',
              'group-hover/card:opacity-100 focus-visible:opacity-100',
              'hover:bg-danger-subtle hover:text-danger-text',
              'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus-ring focus-visible:outline',
            )}
          >
            <CloseIcon className="size-3.5" />
          </button>
        </div>
      </ContextMenuTrigger>

      <ContextMenuContent>
        <ContextMenuItem onSelect={onOpen}>
          <FolderIcon className="size-4 text-fg-muted" />
          Open
        </ContextMenuItem>
        <ContextMenuItem disabled>
          <ExternalIcon className="size-4 text-fg-muted" />
          Open in new window
          <ContextMenuShortcut>Soon</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          onSelect={() => {
            void invoke('system:revealInFolder', { path: workspace.rootPath });
          }}
        >
          <ExternalIcon className="size-4 text-fg-muted" />
          Reveal in File Explorer
        </ContextMenuItem>
        <ContextMenuItem onSelect={copyPath}>
          <CopyIcon className="size-4 text-fg-muted" />
          Copy path
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem danger onSelect={onRemove}>
          <CloseIcon className="size-4" />
          Remove from recent
        </ContextMenuItem>
        <ContextMenuItem danger onSelect={onClearAll}>
          <TrashIcon className="size-4" />
          Clear all recent
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

/**
 * A relative timestamp, with the absolute one on hover via the card's title. "3d ago" is what you
 * scan by; the exact date is what you check when two candidates look alike.
 */
function relativeTime(ms: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${String(minutes)}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${String(hours)}h ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 30) return `${String(days)}d ago`;
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
