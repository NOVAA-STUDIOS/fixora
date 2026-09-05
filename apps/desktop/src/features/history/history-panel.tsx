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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  FileIcon,
  Input,
  RefreshIcon,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  TrashIcon,
  cn,
} from '@fixora/ui';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { invoke } from '../../lib/bridge.js';
import { copyToClipboard } from '../../lib/clipboard.js';
import { basename } from '../../lib/path.js';
import { useAiStore } from '../../stores/ai-store.js';
import { toast } from '../../stores/toast-store.js';
import { useUiStore } from '../../stores/ui-store.js';
import { VerdictBadge } from '../ai/verdict-badge.js';
import { refreshModelText } from '../editor/models.js';
import { useWorkspaceStore } from '../workspace/workspace-store.js';

import { useHistoryStore } from './history-store.js';

/** The status filter's options (FIX 2). 'all' is the default — no filtering. */
type StatusFilter = 'all' | 'passed' | 'forced' | 'proceed';

function matchesStatusFilter(entry: RepairHistoryEntry, filter: StatusFilter): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'passed':
      return entry.verdict === 'verified' && !entry.wasForced;
    case 'forced':
      return entry.wasForced;
    case 'proceed':
      return entry.source === 'proceed';
  }
}

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
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  // Reload whenever the panel is shown, so applying a repair elsewhere is reflected here.
  useEffect(() => {
    void refresh();
  }, [refresh, workspace]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return entries.filter((entry) => {
      if (!matchesStatusFilter(entry, statusFilter)) return false;
      if (query === '') return true;
      return (
        basename(entry.file).toLowerCase().includes(query) ||
        entry.ruleId.toLowerCase().includes(query)
      );
    });
  }, [entries, search, statusFilter]);

  const exportHistory = useCallback(
    async (format: 'json' | 'csv'): Promise<void> => {
      const date = new Date().toISOString().slice(0, 10);
      const filename = `fixora-history-${date}.${format}`;
      const rows = filtered.map((e) => ({
        file: e.file,
        rule: e.ruleId,
        verdict: e.verdict,
        applied: e.applied,
        model: e.model,
        provider: e.provider,
        createdAt: e.createdAt,
      }));
      const content =
        format === 'json'
          ? JSON.stringify(rows, null, 2)
          : [
              'file,rule,verdict,applied,model,provider,createdAt',
              ...rows.map((r) =>
                [r.file, r.rule, r.verdict, String(r.applied), r.model ?? '', r.provider ?? '', String(r.createdAt)]
                  .map((v) => `"${v.replace(/"/g, '""')}"`)
                  .join(','),
              ),
            ].join('\n');
      const result = await invoke('fs:writeFile', { relPath: filename, content });
      if (result.ok) {
        toast.success(`History exported to ${filename}`);
      } else {
        toast.error("Couldn't export history.", result.error.message);
      }
    },
    [filtered],
  );

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
        <h2 className="font-[system-ui] text-[10px] font-semibold tracking-[0.08em] text-fg-muted uppercase">
          Repair history
        </h2>
        <div className="flex shrink-0 items-center gap-1">
          {entries.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="shrink-0" disabled={filtered.length === 0}>
                  Export
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => void exportHistory('json')}>
                  Export as JSON
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => void exportHistory('csv')}>
                  Export as CSV
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
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
        </div>
      </header>

      {entries.length > 0 && (
        <div className="flex shrink-0 items-center gap-1.5 border-b border-border-subtle px-2 py-1.5">
          <Input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
            }}
            placeholder="Search by filename or rule…"
            aria-label="Search history"
            className="h-7 min-w-0 flex-1 text-[11px]"
          />
          <Select
            value={statusFilter}
            onValueChange={(v) => {
              setStatusFilter(v as StatusFilter);
            }}
          >
            <SelectTrigger aria-label="Filter by status" className="h-7 w-36 shrink-0 text-[11px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="passed">Passed verification</SelectItem>
              <SelectItem value="forced">Forced</SelectItem>
              <SelectItem value="proceed">Proceed edits</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

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
      ) : filtered.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-1 p-6 text-center">
          <p className="text-sm font-medium text-fg">No results</p>
          <p className="max-w-xs text-xs text-fg-muted">
            No history entries match your search and filter.
          </p>
        </div>
      ) : (
        <ul className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto p-2">
          {filtered.map((entry) => (
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
  // Revert is only meaningful for a change actually written to disk, and only when the pre-repair
  // text was recorded to write back — both true for every applied entry today, but this stays an
  // explicit check rather than assuming `applied` implies a non-empty `originalCode`.
  const canRevert = entry.applied && entry.originalCode.length > 0;
  const [confirmRevert, setConfirmRevert] = useState(false);
  const [reverting, setReverting] = useState(false);

  const revert = useCallback(async () => {
    setReverting(true);
    try {
      const read = await invoke('fs:readFile', { relPath: entry.file });
      if (!read.ok) {
        toast.error("Couldn't revert repair.", read.error.message);
        return;
      }
      const lines = read.value.file.content.split('\n');
      // 1-based, inclusive range — same convention the repair itself was applied against.
      lines.splice(entry.startLine - 1, entry.endLine - entry.startLine + 1, entry.originalCode);
      const content = lines.join('\n');
      const written = await invoke('fs:writeWorkspaceFile', { relPath: entry.file, content });
      if (!written.ok) {
        toast.error("Couldn't revert repair.", written.error.message);
        return;
      }
      refreshModelText(entry.file, content);
      toast.success(`Repair reverted in ${basename(entry.file)}`);
    } finally {
      setReverting(false);
    }
  }, [entry]);

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
              {entry.wasForced && (
                <span
                  className="shrink-0 rounded-full bg-warn-subtle px-1.5 py-px text-[10px] font-medium text-warn-text"
                  title="Applied without passing verification"
                >
                  forced
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

            {/* Provider History: which provider actually answered, and — only when it matters —
                that Fixora tried others first. Absent for entries recorded before this shipped, so
                an old row simply omits the line rather than showing a false "unknown". */}
            {entry.provider !== null && (
              <span
                className="flex min-w-0 items-center gap-1.5 text-[10px] text-fg-muted"
                title={
                  entry.attempts.length > 0
                    ? `Also tried: ${entry.attempts.map((a) => `${a.provider}/${a.model}`).join(', ')}`
                    : undefined
                }
              >
                <span className="min-w-0 truncate">
                  {entry.provider}
                  {entry.model !== null ? ` · ${entry.model}` : ''}
                </span>
                {entry.attempts.length > 0 && (
                  <span className="shrink-0 rounded-full bg-warn-subtle px-1.5 py-px text-warn-text">
                    retried {entry.attempts.length}×
                  </span>
                )}
              </span>
            )}
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
        {canRevert && (
          <ContextMenuItem
            disabled={reverting}
            onSelect={() => {
              setConfirmRevert(true);
            }}
          >
            <RefreshIcon className="size-4 text-fg-muted" />
            Revert this repair
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

      <ConfirmDialog
        open={confirmRevert}
        onOpenChange={setConfirmRevert}
        title="Revert this repair?"
        description="This will replace the current file content at the repaired range with the original code. This cannot be undone."
        confirmLabel="Revert"
        onConfirm={() => void revert()}
      />
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
