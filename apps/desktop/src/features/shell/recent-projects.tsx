import type { WorkspaceInfo } from '@fixora/shared-types';
import {
  CloseIcon,
  ConfirmDialog,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
  CopyIcon,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  ExternalIcon,
  FolderIcon,
  MoreIcon,
  PinIcon,
  TrashIcon,
  cn,
} from '@fixora/ui';
import { useCallback, useEffect, useState, type ReactNode } from 'react';

import { invoke } from '../../lib/bridge.js';
import { copyToClipboard } from '../../lib/clipboard.js';
import { useWorkspaceStore } from '../workspace/workspace-store.js';

/**
 * The recent-projects list on the Home screen.
 *
 * This is the list a desktop user manages, not just reads: projects accumulate, and the ones you
 * opened once by accident stay there forever unless you can remove them. So it behaves the way the
 * equivalent list does in VS Code — a hover-only ✕ on each row, a menu with the operations that
 * belong to a path, and a Clear All behind a confirmation.
 *
 * The safety line matters more than any of it and is stated in the UI itself: removing an entry is
 * a *list* operation. It forgets a bookmark. It never touches the folder, and the confirmation says
 * so in as many words, because "Clear all recent projects" is a sentence that can reasonably be
 * misread as "delete my projects".
 *
 * A card's menu is reachable two ways (beta audit A1, finding: the original right-click-only menu
 * had no on-screen affordance at all, so Reveal/Copy path were effectively undiscoverable): a
 * right-click anywhere on the card, and a visible "More actions" (⋯) button. Both render the same
 * items, driven from the same `menuActions` data below the split into three groups — there is
 * exactly one place each action's label/icon/handler is defined.
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

  /** Pin/unpin (Sprint F2). The list re-sorts itself — pinned entries sort first server-side. */
  const togglePin = useCallback((id: string, pinned: boolean) => {
    void invoke('workspace:setPinned', { id, pinned }).then((r) => {
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
        {shownWorkspaces(recent).map((w) => (
          <RecentCard
            key={w.id}
            workspace={w}
            busy={opening}
            leaving={removing.includes(w.id)}
            onOpen={() => void openPath(w.rootPath)}
            onRemove={() => {
              remove(w.id);
            }}
            onTogglePin={() => {
              togglePin(w.id, w.pinnedAt === null);
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

/**
 * Which of `recent` to show, at most 6. Pinned entries are prioritised (the backend already returns
 * them first), but never so completely that pinning several projects makes every unpinned-but-recent
 * one unreachable from this screen — the only other place a not-yet-opened project's path could come
 * from is picking its folder again from scratch. At least `MIN_UNPINNED_SLOTS` unpinned entries (if
 * that many exist) are always reserved, even when 6+ projects are pinned. (Beta audit A1, Recent
 * Projects finding: pinning ≥6 projects hid every unpinned recent with no way back to it.)
 */
const MAX_SHOWN = 6;
const MIN_UNPINNED_SLOTS = 2;

function shownWorkspaces(recent: WorkspaceInfo[]): WorkspaceInfo[] {
  const pinned = recent.filter((w) => w.pinnedAt !== null);
  const unpinned = recent.filter((w) => w.pinnedAt === null);
  const reservedForUnpinned = Math.min(MIN_UNPINNED_SLOTS, unpinned.length);
  const pinnedShown = pinned.slice(0, Math.max(0, MAX_SHOWN - reservedForUnpinned));
  const unpinnedShown = unpinned.slice(0, MAX_SHOWN - pinnedShown.length);
  return [...pinnedShown, ...unpinnedShown];
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

type MenuAction = { key: string; icon: ReactNode; label: string; onSelect: () => void };

function RecentCard({
  workspace,
  busy,
  leaving,
  onOpen,
  onRemove,
  onTogglePin,
  onClearAll,
}: {
  workspace: WorkspaceInfo;
  busy: boolean;
  leaving: boolean;
  onOpen: () => void;
  onRemove: () => void;
  onTogglePin: () => void;
  onClearAll: () => void;
}): React.JSX.Element {
  const [copied, setCopied] = useState(false);
  const pinned = workspace.pinnedAt !== null;
  const [menuOpen, setMenuOpen] = useState(false);

  const copyPath = (): void => {
    void copyToClipboard(workspace.rootPath, { label: 'Path copied' }).then((ok) => {
      if (!ok) return;
      setCopied(true);
      window.setTimeout(() => {
        setCopied(false);
      }, 1200);
    });
  };

  // Three groups (primary, path-related, destructive), rendered identically into the right-click
  // menu and the visible "More actions" menu — one definition, two triggers. Rebuilt each render
  // (cheap — a handful of objects for one card) rather than memoized, so it never risks holding a
  // stale closure over `pinned`/`copied`.
  const primaryActions: MenuAction[] = [
    { key: 'open', icon: <FolderIcon className="size-4 text-fg-muted" />, label: 'Open', onSelect: onOpen },
    {
      key: 'pin',
      icon: <PinIcon className="size-4 text-fg-muted" fill={pinned ? 'currentColor' : 'none'} />,
      label: pinned ? 'Unpin project' : 'Pin project',
      onSelect: onTogglePin,
    },
  ];
  const pathActions: MenuAction[] = [
    {
      key: 'reveal',
      icon: <ExternalIcon className="size-4 text-fg-muted" />,
      label: 'Reveal in File Explorer',
      onSelect: () => {
        void invoke('system:revealInFolder', { path: workspace.rootPath });
      },
    },
    { key: 'copy', icon: <CopyIcon className="size-4 text-fg-muted" />, label: 'Copy path', onSelect: copyPath },
  ];
  const dangerActions: MenuAction[] = [
    { key: 'remove', icon: <CloseIcon className="size-4" />, label: 'Remove from recent', onSelect: onRemove },
    { key: 'clear', icon: <TrashIcon className="size-4" />, label: 'Clear all recent', onSelect: onClearAll },
  ];

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

          {/* Top-right cluster: More actions + Pin. Remove sits at the bottom-right corner instead
              of vertically centered, so the three overlay controls don't crowd one corner (beta
              audit A1, Recent Projects finding: pin/remove sat close enough to risk a mis-click). */}
          <div className="absolute right-2 top-2 flex items-center gap-0.5">
            <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                  }}
                  aria-label={`More actions for ${workspace.name}`}
                  title="More actions"
                  className={cn(
                    'rounded-md p-1 text-fg-muted opacity-0 transition-[opacity,background-color,color] duration-(--fx-motion-duration-fast)',
                    'group-hover/card:opacity-100 focus-visible:opacity-100 hover:bg-hover hover:text-fg',
                    menuOpen && 'opacity-100 bg-hover text-fg',
                    'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus-ring focus-visible:outline',
                  )}
                >
                  <MoreIcon className="size-3.5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {primaryActions.map((a) => (
                  <DropdownMenuItem key={a.key} onSelect={a.onSelect}>
                    {a.icon}
                    {a.label}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                {pathActions.map((a) => (
                  <DropdownMenuItem key={a.key} onSelect={a.onSelect}>
                    {a.icon}
                    {a.label}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                {dangerActions.map((a) => (
                  <DropdownMenuItem key={a.key} danger onSelect={a.onSelect}>
                    {a.icon}
                    {a.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Pinned stays visible always (it is the fact the sort order is keyed on); unpinned is
                hover/focus-only, same convention as the buttons beside it. */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onTogglePin();
              }}
              aria-label={pinned ? `Unpin ${workspace.name}` : `Pin ${workspace.name}`}
              aria-pressed={pinned}
              title={pinned ? 'Unpin project' : 'Pin project to the top of Recent'}
              className={cn(
                'rounded-md p-1',
                'transition-[opacity,background-color,color] duration-(--fx-motion-duration-fast)',
                pinned
                  ? 'text-accent-text opacity-100'
                  : [
                      'text-fg-muted opacity-0',
                      'group-hover/card:opacity-100 focus-visible:opacity-100',
                      'hover:bg-hover hover:text-fg',
                    ],
                'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus-ring focus-visible:outline',
              )}
            >
              <PinIcon className="size-3.5" fill={pinned ? 'currentColor' : 'none'} />
            </button>
          </div>

          <button
            type="button"
            // Hover-only, but always reachable by keyboard: `focus-visible` brings it back, so the
            // control is not mouse-exclusive.
            onClick={onRemove}
            aria-label={`Remove ${workspace.name} from recent projects`}
            title="Remove from recent (does not delete the folder)"
            className={cn(
              'absolute bottom-2 right-2.5 rounded-md p-1.5',
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
        {primaryActions.map((a) => (
          <ContextMenuItem key={a.key} onSelect={a.onSelect}>
            {a.icon}
            {a.label}
          </ContextMenuItem>
        ))}
        <ContextMenuSeparator />
        {pathActions.map((a) => (
          <ContextMenuItem key={a.key} onSelect={a.onSelect}>
            {a.icon}
            {a.label}
          </ContextMenuItem>
        ))}
        <ContextMenuSeparator />
        {dangerActions.map((a) => (
          <ContextMenuItem key={a.key} danger onSelect={a.onSelect}>
            {a.icon}
            {a.label}
          </ContextMenuItem>
        ))}
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
