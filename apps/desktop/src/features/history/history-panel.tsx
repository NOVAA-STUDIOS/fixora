import type { RepairHistoryEntry } from '@fixora/shared-types';
import {
  Button,
  CheckIcon,
  ClockIcon,
  CloseIcon,
  ConfirmDialog,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
  CopyIcon,
  FileIcon,
  RefreshIcon,
  TrashIcon,
  cn,
} from '@fixora/ui';
import { useCallback, useEffect, useState } from 'react';

import { invoke } from '../../lib/bridge.js';
import { copyToClipboard } from '../../lib/clipboard.js';
import { basename } from '../../lib/path.js';
import { useAiStore } from '../../stores/ai-store.js';
import { useUiStore } from '../../stores/ui-store.js';
import { VerdictBadge } from '../ai/verdict-badge.js';
import { useWorkspaceStore } from '../workspace/workspace-store.js';

import { useHistoryStore } from './history-store.js';

/**
 * The repair history panel (Beta Phase E) — the local, private audit trail. Every repair the user
 * reviewed is here with its verification verdict and whether it was applied, newest first.
 *
 * It is the user's record, so they get to curate it: a hover-only ✕ per row, a right-click menu,
 * and Clear history behind a confirmation. The important distinction is stated plainly in that
 * confirmation, because it is genuinely ambiguous — deleting an entry removes the *record* of a
 * repair. It does not revert the repair. That change is already in the file, and undoing it is the
 * editor's job, not the audit log's.
 */
export function HistoryPanel(): React.JSX.Element {
  const entries = useHistoryStore((s) => s.entries);
  const loaded = useHistoryStore((s) => s.loaded);
  const refresh = useHistoryStore((s) => s.refresh);
  const workspace = useWorkspaceStore((s) => s.workspace);
  const setActiveView = useUiStore((s) => s.setActiveView);

  const [removing, setRemoving] = useState<string[]>([]);
  const [confirmClear, setConfirmClear] = useState(false);

  // Reload whenever the panel is shown, so applying a repair elsewhere is reflected here.
  useEffect(() => {
    void refresh();
  }, [refresh, workspace]);

  /**
   * Delete with an exit animation: the row is marked first, plays a 160ms collapse, and only then
   * leaves the list. Without it the row disappears between frames and everything below jumps up —
   * the user cannot tell whether they deleted the one they aimed at.
   */
  const remove = useCallback(
    (id: string) => {
      setRemoving((ids) => [...ids, id]);
      window.setTimeout(() => {
        void invoke('ai:historyRemove', { id }).then(() => {
          void refresh();
          setRemoving((ids) => ids.filter((x) => x !== id));
        });
      }, 160);
    },
    [refresh],
  );

  const clearAll = useCallback(() => {
    void invoke('ai:historyClear', {}).then(() => void refresh());
  }, [refresh]);

  return (
    <section
      aria-label="Repair history"
      className="flex h-full min-w-0 flex-col overflow-hidden rounded-lg border border-border-subtle bg-raised"
    >
      <header className="flex h-9 shrink-0 items-center justify-between gap-2 border-b border-border-subtle px-3">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-fg-secondary">
          Repair history
        </h2>
        {entries.length > 0 && (
          <button
            type="button"
            onClick={() => {
              setConfirmClear(true);
            }}
            className="shrink-0 rounded px-1.5 py-0.5 text-[11px] text-fg-muted transition-colors duration-(--fx-motion-duration-fast) hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus-ring focus-visible:outline"
          >
            Clear
          </button>
        )}
      </header>

      {entries.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
          {loaded ? (
            <>
              <span className="flex size-10 items-center justify-center rounded-full bg-inset">
                <ClockIcon className="size-5 text-fg-muted" />
              </span>
              <div className="flex flex-col gap-1">
                <p className="text-sm font-medium text-fg">No repairs yet</p>
                <p className="max-w-xs text-xs leading-relaxed text-fg-muted">
                  Every repair you review is recorded here — its verdict, the code before and after,
                  and whether you applied it. It stays on your machine.
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setActiveView('findings');
                }}
              >
                Go to Problems
              </Button>
            </>
          ) : (
            // Skeletons, not a "Loading…" string: the panel keeps its shape while the query runs.
            <div className="flex w-full flex-col gap-2" aria-busy="true">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="h-16 animate-pulse rounded-lg border border-border-subtle bg-inset"
                />
              ))}
            </div>
          )}
        </div>
      ) : (
        <ul className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto p-2">
          {entries.map((entry) => (
            <HistoryRow
              key={entry.id}
              entry={entry}
              leaving={removing.includes(entry.id)}
              onRemove={() => {
                remove(entry.id);
              }}
              onClearAll={() => {
                setConfirmClear(true);
              }}
            />
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={confirmClear}
        onOpenChange={setConfirmClear}
        title="Clear repair history?"
        description="This deletes the record of every repair you reviewed in this project. It does not revert any repair you applied — those changes are already in your files and stay exactly as they are."
        confirmLabel="Clear history"
        onConfirm={clearAll}
      />
    </section>
  );
}

function HistoryRow({
  entry,
  leaving,
  onRemove,
  onClearAll,
}: {
  entry: RepairHistoryEntry;
  leaving: boolean;
  onRemove: () => void;
  onClearAll: () => void;
}): React.JSX.Element {
  const selectFile = useWorkspaceStore((s) => s.selectFile);
  const runAi = useAiStore((s) => s.run);
  const aiConfigured = useAiStore((s) => s.config?.configured ?? false);
  // Audit A9 (B1): a Proceed edit has no analyzer Finding behind it — it's recorded with a synthetic
  // `findingId` (`proceed:<file>:<startLine>-<endLine>`) purely for the audit trail (Audit A6). Re-run
  // always resolved that id to `null` and showed "That finding is no longer available.", which is
  // false: it was never a finding to begin with. Only a real Repair entry can be re-run.
  const isProceedEntry = entry.source === 'proceed';

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <li
          className={cn(
            'group/row relative min-w-0 list-none',
            'transition-[opacity,transform] duration-(--fx-motion-duration-normal) ease-(--ease-exit)',
            leaving && 'pointer-events-none scale-95 opacity-0',
          )}
        >
          <button
            type="button"
            onClick={() => {
              selectFile(entry.file);
            }}
            title={entry.rationale}
            className={cn(
              'flex w-full min-w-0 flex-col items-stretch gap-1.5 rounded-lg border border-border-subtle bg-inset px-3 py-2.5 text-left',
              'transition-[background-color,border-color] duration-(--fx-motion-duration-fast) ease-(--ease-entrance)',
              'hover:border-accent-border hover:bg-hover',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring focus-visible:outline',
            )}
          >
            {/* Verdict leads: it is the one thing that decides whether this entry is good news. */}
            <span className="flex w-full min-w-0 items-center gap-2">
              <VerdictBadge verdict={entry.verdict} />
              {entry.applied && (
                <span className="flex shrink-0 items-center gap-1 rounded-full bg-success-subtle px-1.5 py-px text-[10px] font-medium text-success-text">
                  <CheckIcon className="size-2.5" />
                  applied
                </span>
              )}
              {/* Yields to the ✕ on hover, so the two never collide in the same corner. */}
              <span className="ml-auto shrink-0 text-[11px] tabular-nums text-fg-muted transition-opacity duration-(--fx-motion-duration-fast) group-hover/row:opacity-0">
                {relativeTime(entry.createdAt)}
              </span>
            </span>

            <span className="block min-w-0 truncate text-xs leading-snug font-medium text-fg">
              {entry.rationale}
            </span>

            <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-fg-muted">
              <FileIcon className="size-3 shrink-0" />
              <span className="min-w-0 truncate font-mono">{basename(entry.file)}</span>
              <span aria-hidden="true" className="shrink-0 text-border-strong">
                ·
              </span>
              <span className="min-w-0 truncate">{entry.ruleId}</span>
            </span>
          </button>

          <button
            type="button"
            onClick={onRemove}
            aria-label="Delete this history entry"
            title="Delete this entry (does not revert the repair)"
            className={cn(
              'absolute right-2 top-2 rounded-md p-1',
              'text-fg-muted opacity-0 transition-[opacity,background-color,color] duration-(--fx-motion-duration-fast)',
              'group-hover/row:opacity-100 focus-visible:opacity-100',
              'hover:bg-danger-subtle hover:text-danger-text',
              'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus-ring focus-visible:outline',
            )}
          >
            <CloseIcon className="size-3.5" />
          </button>
        </li>
      </ContextMenuTrigger>

      <ContextMenuContent>
        <ContextMenuItem
          onSelect={() => {
            selectFile(entry.file);
          }}
        >
          <FileIcon className="size-4 text-fg-muted" />
          Open result
        </ContextMenuItem>
        <ContextMenuItem
          onSelect={() => {
            void copyToClipboard(entry.repairedCode, { label: 'Repaired code copied' });
          }}
        >
          <CopyIcon className="size-4 text-fg-muted" />
          Copy repaired code
        </ContextMenuItem>
        {!isProceedEntry && (
          <ContextMenuItem
            disabled={!aiConfigured}
            onSelect={() => {
              void runAi('repair', entry.findingId);
            }}
          >
            <RefreshIcon className="size-4 text-fg-muted" />
            Re-run repair
          </ContextMenuItem>
        )}
        <ContextMenuSeparator />
        <ContextMenuItem danger onSelect={onRemove}>
          <CloseIcon className="size-4" />
          Delete entry
        </ContextMenuItem>
        <ContextMenuItem danger onSelect={onClearAll}>
          <TrashIcon className="size-4" />
          Clear history
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

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
