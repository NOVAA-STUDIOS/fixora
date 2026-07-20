import type { RepairHistoryEntry } from '@fixora/shared-types';
import { Button, CheckIcon, cn } from '@fixora/ui';
import { useEffect } from 'react';

import { basename } from '../../lib/path.js';
import { useUiStore } from '../../stores/ui-store.js';
import { VerdictBadge } from '../ai/verdict-badge.js';
import { useWorkspaceStore } from '../workspace/workspace-store.js';

import { useHistoryStore } from './history-store.js';

/**
 * The repair history panel (Beta Phase E) — the local, private audit trail. Every repair the user
 * reviewed is here with its verification verdict and whether it was applied, newest first. Clicking one
 * opens its file. This is what makes "trust us with your code" inspectable: the user can see exactly
 * what the AI proposed and what they accepted, and it survives a restart because the data does.
 */
export function HistoryPanel(): React.JSX.Element {
  const entries = useHistoryStore((s) => s.entries);
  const loaded = useHistoryStore((s) => s.loaded);
  const refresh = useHistoryStore((s) => s.refresh);
  const workspace = useWorkspaceStore((s) => s.workspace);
  const setActiveView = useUiStore((s) => s.setActiveView);

  // Reload whenever the panel is shown, so applying a repair elsewhere is reflected here.
  useEffect(() => {
    void refresh();
  }, [refresh, workspace]);

  return (
    <section
      aria-label="Repair history"
      className="flex h-full min-w-0 flex-col border-r border-border-subtle bg-canvas"
    >
      <header className="flex h-8 shrink-0 items-center border-b border-border-subtle px-3">
        <span className="text-xs font-semibold text-fg">Repair history</span>
      </header>

      {entries.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
          {loaded ? (
            <>
              <p className="text-sm font-medium text-fg">No repairs yet</p>
              <p className="max-w-xs text-xs text-fg-muted">
                Every repair you review is recorded here — its verdict, the code before and after,
                and whether you applied it. It stays on your machine.
              </p>
              <Button
                variant="ghost"
                size="sm"
                className="mt-1"
                onClick={() => {
                  setActiveView('findings');
                }}
              >
                Go to Problems
              </Button>
            </>
          ) : (
            <p className="text-sm text-fg-muted">Loading…</p>
          )}
        </div>
      ) : (
        <ul className="min-h-0 flex-1 overflow-y-auto">
          {entries.map((entry) => (
            <HistoryRow key={entry.id} entry={entry} />
          ))}
        </ul>
      )}
    </section>
  );
}

function HistoryRow({ entry }: { entry: RepairHistoryEntry }): React.JSX.Element {
  const selectFile = useWorkspaceStore((s) => s.selectFile);
  return (
    <li className="min-w-0 border-b border-border-subtle">
      <button
        type="button"
        onClick={() => {
          selectFile(entry.file);
        }}
        title={entry.rationale}
        className="flex w-full min-w-0 flex-col items-stretch gap-1 px-3 py-2 text-left hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus-ring focus-visible:outline"
      >
        {/* flex-wrap so the badge row degrades to two lines in a narrow pane rather than pushing the
            timestamp out of the panel. */}
        <span className="flex w-full min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <VerdictBadge verdict={entry.verdict} />
          {entry.applied && (
            <span className="flex shrink-0 items-center gap-0.5 text-[10px] text-success-text">
              <CheckIcon className="size-3" /> applied
            </span>
          )}
          <span className="ml-auto shrink-0 text-[10px] text-fg-muted">
            {new Date(entry.createdAt).toLocaleString()}
          </span>
        </span>
        {/* `truncate` needs a width to truncate *to*. Under the previous `items-start` these spans
            sized to their content, so a long rationale or a long rule id simply ran past the panel
            edge and scrolled the whole list sideways. items-stretch + min-w-0 gives them the pane. */}
        <span className="block min-w-0 truncate text-xs text-fg">{entry.rationale}</span>
        <span className={cn('block min-w-0 truncate text-[11px] text-fg-muted')}>
          {basename(entry.file)}
          {entry.symbolName !== null && ` · ${entry.symbolName}`} · {entry.source} ({entry.ruleId})
        </span>
      </button>
    </li>
  );
}
