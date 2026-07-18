import type { Finding, Severity, TaskProfile } from '@fixora/shared-types';
import { AlertIcon, Button, CheckIcon, VirtualList, cn } from '@fixora/ui';
import { useEffect } from 'react';

import { basename } from '../../lib/path.js';
import { useAiStore } from '../../stores/ai-store.js';
import { useUiStore } from '../../stores/ui-store.js';
import { useWorkspaceStore } from '../workspace/workspace-store.js';

import { useFindingsStore } from './findings-store.js';

/**
 * The findings panel (roadmap M3): the evidence layer made visible. Virtualised, filterable by
 * severity. Clicking a finding jumps to and highlights the exact line, and every finding carries its
 * rule, severity, and the actions a first-timer needs — Explain, Repair, Test — right there, no hover
 * required. Zero AI in the findings themselves; this is the moat with the LLM switched off.
 */

/** Fixed row height. Must match what FindingRow can actually occupy — see the VirtualList note. */
const ROW_HEIGHT = 96;

const SEVERITY_ORDER: Severity[] = ['error', 'warning', 'info'];
const SEVERITY_STYLE: Record<Severity, string> = {
  error: 'text-danger-text',
  warning: 'text-warning-text',
  info: 'text-fg-muted',
};
const SEVERITY_BADGE: Record<Severity, string> = {
  error: 'bg-danger-bg text-danger-text',
  warning: 'bg-warning-bg text-warning-text',
  info: 'bg-hover text-fg-muted',
};

export function FindingsPanel(): React.JSX.Element {
  const findings = useFindingsStore((s) => s.findings);
  const summary = useFindingsStore((s) => s.summary);
  const status = useFindingsStore((s) => s.status);
  const filter = useFindingsStore((s) => s.filter);
  const ignoredIds = useFindingsStore((s) => s.ignoredIds);
  const refresh = useFindingsStore((s) => s.refresh);
  const run = useFindingsStore((s) => s.run);
  const cancel = useFindingsStore((s) => s.cancel);
  const setFilter = useFindingsStore((s) => s.setFilter);
  const showIgnored = useFindingsStore((s) => s.showIgnored);
  const listen = useFindingsStore((s) => s.listen);
  const selectedId = useFindingsStore((s) => s.selectedId);

  const workspace = useWorkspaceStore((s) => s.workspace);

  useEffect(() => listen(), [listen]);
  useEffect(() => {
    if (workspace !== null) void refresh();
  }, [workspace, refresh]);

  const visible = findings.filter((f) => !ignoredIds.includes(f.id));
  const hiddenHere = findings.length - visible.length;

  return (
    <section
      aria-label="Problems"
      className="flex h-full min-w-0 flex-col border-r border-border-subtle bg-canvas"
    >
      <header className="flex h-9 shrink-0 items-center justify-between gap-2 border-b border-border-subtle px-3">
        <span className="truncate text-xs font-semibold text-fg">Problems</span>
        {status === 'running' ? (
          <Button variant="ghost" size="sm" onClick={() => void cancel()}>
            Cancel
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void run()}
            disabled={workspace === null}
          >
            {summary === null ? 'Run analysis' : 'Re-run'}
          </Button>
        )}
      </header>

      <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-border-subtle px-2 py-1.5">
        <SeverityFilter
          label="All"
          active={filter.severity === undefined}
          count={summary?.total}
          onClick={() => void setFilter({})}
        />
        {SEVERITY_ORDER.map((sev) => (
          <SeverityFilter
            key={sev}
            label={sev}
            active={filter.severity === sev}
            count={summary?.bySeverity[sev]}
            className={SEVERITY_STYLE[sev]}
            onClick={() => void setFilter({ severity: sev })}
          />
        ))}
        {hiddenHere > 0 && (
          <button
            type="button"
            onClick={showIgnored}
            className="ml-auto rounded px-2 py-0.5 text-xs text-fg-muted hover:text-fg"
          >
            {hiddenHere} hidden · show
          </button>
        )}
      </div>

      {visible.length === 0 ? (
        <EmptyState
          status={status}
          hasWorkspace={workspace !== null}
          summary={summary}
          filterActive={filter.severity !== undefined}
          allHidden={findings.length > 0}
          onRun={() => void run()}
          onShowAll={() => void setFilter({})}
          onShowHidden={showIgnored}
        />
      ) : (
        <VirtualList
          items={visible}
          label="Problems"
          // The list positions rows at a fixed stride, so a row must never be taller than this or
          // rows overlap. FindingRow is built to fit: the message is clamped to two lines and the
          // full text lives in the details panel, which is where a long message belongs anyway.
          estimateRowHeight={ROW_HEIGHT}
          isSelected={(f) => f.id === selectedId}
          getKey={(f) => f.id}
          className="min-h-0 flex-1"
          renderItem={(finding) => <FindingRow finding={finding} />}
        />
      )}
    </section>
  );
}

const AI_ACTIONS: readonly { profile: TaskProfile; label: string }[] = [
  { profile: 'explain', label: 'Explain' },
  { profile: 'repair', label: 'Repair' },
  { profile: 'test', label: 'Test' },
];

function SeverityFilter({
  label,
  count,
  active,
  className,
  onClick,
}: {
  label: string;
  count: number | undefined;
  active: boolean;
  className?: string;
  onClick: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-center gap-1 rounded px-2 py-0.5 text-xs capitalize',
        'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus-ring focus-visible:outline',
        active ? 'bg-hover text-fg' : 'text-fg-muted hover:text-fg',
        className,
      )}
    >
      {label}
      {count !== undefined && count > 0 && <span className="tabular-nums">{count}</span>}
    </button>
  );
}

function FindingRow({ finding }: { finding: Finding }): React.JSX.Element {
  const revealAt = useWorkspaceStore((s) => s.revealAt);
  const ignore = useFindingsStore((s) => s.ignore);
  const select = useFindingsStore((s) => s.select);
  const isSelected = useFindingsStore((s) => s.selectedId === finding.id);
  const runAi = useAiStore((s) => s.run);
  const aiConfigured = useAiStore((s) => s.config?.configured ?? false);
  const aiBusy = useAiStore((s) => s.status === 'running');
  const setActiveView = useUiStore((s) => s.setActiveView);

  return (
    <div
      className={cn(
        // h-full + overflow-hidden: the row owns exactly its slot in the virtual list and can never
        // spill onto the row below, whatever the message length or the user's font scaling.
        'flex h-full flex-col justify-center gap-1.5 overflow-hidden border-b border-border-subtle px-3 py-2',
        // The selected row is what the details pane is describing — say so, with a bar rather than a
        // fill, so the severity colours stay the loudest thing in the list.
        isSelected && 'bg-hover shadow-[inset_2px_0_0_0_var(--fx-color-accent)]',
      )}
    >
      <button
        type="button"
        onClick={() => {
          // One click does the whole job: describe it, open it, jump to it, highlight it.
          select(finding.id);
          revealAt(finding.location);
        }}
        aria-current={isSelected}
        // The clamped message is still readable in full on hover, without opening the details pane.
        title={`${finding.message}\n${finding.location.file}:${String(finding.location.startLine)} — click for details`}
        className="flex w-full flex-col items-start gap-1 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring focus-visible:outline"
      >
        <span className="flex w-full items-start gap-1.5">
          <AlertIcon className={cn('mt-0.5 size-3.5 shrink-0', SEVERITY_STYLE[finding.severity])} />
          {/* Clamped to two lines so every row is the same height. The full message — and the rule
              id in full — are in the details panel one click away. */}
          <span className="line-clamp-2 text-xs leading-snug text-fg">{finding.message}</span>
        </span>
        <span className="flex w-full min-w-0 items-center gap-1.5 pl-5">
          <span
            className={cn(
              'shrink-0 rounded px-1 py-px text-[10px] font-medium capitalize',
              SEVERITY_BADGE[finding.severity],
            )}
          >
            {finding.severity}
          </span>
          <span className="min-w-0 truncate text-[11px] text-fg-muted">
            {basename(finding.location.file)}:{finding.location.startLine} · {finding.source} ·{' '}
            {finding.ruleId}
          </span>
        </span>
      </button>

      <div className="flex items-center gap-1 pl-5">
        {aiConfigured ? (
          AI_ACTIONS.map((action) => (
            <button
              key={action.profile}
              type="button"
              disabled={aiBusy}
              onClick={() => void runAi(action.profile, finding.id)}
              className="rounded border border-border-subtle px-2 py-0.5 text-[11px] text-fg-secondary hover:bg-hover hover:text-fg disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus-ring focus-visible:outline"
            >
              {action.label}
            </button>
          ))
        ) : (
          <button
            type="button"
            onClick={() => {
              setActiveView('settings');
            }}
            className="rounded border border-border-subtle px-2 py-0.5 text-[11px] text-accent-text hover:bg-hover"
          >
            Set up AI to repair
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            ignore(finding.id);
          }}
          title="Hide this finding for now"
          className="ml-auto rounded px-2 py-0.5 text-[11px] text-fg-muted hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus-ring focus-visible:outline"
        >
          Ignore
        </button>
      </div>
    </div>
  );
}

function EmptyState({
  status,
  hasWorkspace,
  summary,
  filterActive,
  allHidden,
  onRun,
  onShowAll,
  onShowHidden,
}: {
  status: string;
  hasWorkspace: boolean;
  summary: { total: number } | null;
  filterActive: boolean;
  allHidden: boolean;
  onRun: () => void;
  onShowAll: () => void;
  onShowHidden: () => void;
}): React.JSX.Element {
  const pickAndOpen = useWorkspaceStore((s) => s.pickAndOpen);

  if (!hasWorkspace) {
    return (
      <Centered
        title="No folder open"
        body="Open a project, then run analysis to find problems."
        action={
          <Button variant="primary" size="sm" onClick={() => void pickAndOpen()}>
            Open folder
          </Button>
        }
      />
    );
  }
  if (status === 'running') {
    return (
      <Centered title="Analyzing…" body="Running your linters and type-checker on this project." />
    );
  }
  if (summary === null) {
    return (
      <Centered
        title="Ready to analyze"
        body="Run analysis to find problems using your own ESLint, TypeScript, and more."
        action={
          <Button variant="primary" size="sm" onClick={onRun}>
            Run analysis
          </Button>
        }
      />
    );
  }
  if (allHidden) {
    return (
      <Centered
        title="Everything hidden"
        body="You've ignored the findings shown here for this session."
        action={
          <Button variant="ghost" size="sm" onClick={onShowHidden}>
            Show hidden
          </Button>
        }
      />
    );
  }
  if (filterActive) {
    return (
      <Centered
        title="Nothing matches this filter"
        body="There are no findings at this severity."
        action={
          <Button variant="ghost" size="sm" onClick={onShowAll}>
            Show all
          </Button>
        }
      />
    );
  }
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
      <CheckIcon className="size-8 text-success-text" />
      <p className="text-sm font-medium text-fg">No problems found</p>
      <p className="max-w-xs text-xs text-fg-muted">
        Your code passed every check Fixora ran. Re-run after you make changes.
      </p>
    </div>
  );
}

function Centered({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
      <p className="text-sm font-medium text-fg">{title}</p>
      <p className="max-w-xs text-xs text-fg-muted">{body}</p>
      {action !== undefined && <div className="mt-1">{action}</div>}
    </div>
  );
}
