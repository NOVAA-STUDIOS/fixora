import type { Finding, Severity, TaskProfile } from '@fixora/shared-types';
import { AlertIcon, Button, CheckIcon, FolderIcon, VirtualList, cn } from '@fixora/ui';
import { useEffect } from 'react';

import { useFindingRowEstimate } from '../../hooks/use-density-metrics.js';
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

const SEVERITY_ORDER: Severity[] = ['error', 'warning', 'info'];
const SEVERITY_STYLE: Record<Severity, string> = {
  error: 'text-danger-text',
  warning: 'text-warn-text',
  info: 'text-fg-muted',
};
/** The severity dot. Colour is the only thing carrying severity in a row now, so it is a fill,
 *  not a tint — a 8px dot in a background-tint colour is invisible against the row. */
const SEVERITY_DOT: Record<Severity, string> = {
  error: 'bg-danger',
  warning: 'bg-warn',
  info: 'bg-border-strong',
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
  const rowEstimate = useFindingRowEstimate();

  useEffect(() => listen(), [listen]);
  useEffect(() => {
    if (workspace !== null) void refresh();
  }, [workspace, refresh]);

  const visible = findings.filter((f) => !ignoredIds.includes(f.id));
  const hiddenHere = findings.length - visible.length;

  return (
    <section
      aria-label="Problems"
      className="flex h-full min-w-0 flex-col overflow-hidden rounded-lg border border-border-subtle bg-raised"
    >
      <header className="flex h-9 shrink-0 items-center justify-between gap-2 border-b border-border-subtle px-3">
        <h2 className="truncate text-[11px] font-semibold uppercase tracking-wider text-fg-secondary">
          Problems
        </h2>
        {status === 'running' ? (
          <Button variant="ghost" size="sm" className="shrink-0" onClick={() => void cancel()}>
            Cancel
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            className="shrink-0"
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
          // Measured, not assumed. A finding row wraps text and carries a row of action buttons, so
          // its real height moves with density and with OS text scaling — a fixed 96px stride was a
          // guess tuned for comfortable/100%, and at compact it left gaps while at 150% it cut the
          // Ignore button in half. `dynamicRowHeight` makes the row tell the list how tall it is.
          estimateRowHeight={rowEstimate}
          dynamicRowHeight
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
        // The row is measured, so it sizes to its own content and the list makes room for it — no
        // h-full to fill a fixed slot, and no overflow-hidden, which would have clipped exactly the
        // content the measurement exists to accommodate. min-w-0 keeps it shrinking with the pane.
        'group/row flex min-w-0 flex-col gap-1.5 border-b border-border-subtle px-3 py-2',
        'transition-colors duration-(--fx-motion-duration-fast) ease-(--ease-entrance)',
        !isSelected && 'hover:bg-hover',
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
        className="flex w-full min-w-0 flex-col items-start gap-1 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring focus-visible:outline"
      >
        <span className="flex w-full min-w-0 items-start gap-2">
          {/*
            A severity dot, not a repeated alert glyph plus a repeated word. The old row spent an
            icon AND a text badge saying the same thing ("⚠ … Warning"), which is two pieces of
            furniture for one bit of information — in a 220px column that is most of the first line.
            Colour carries it, and the badge's job moves to the label a screen reader reads.
          */}
          <span
            aria-hidden="true"
            className={cn('mt-[5px] size-2 shrink-0 rounded-full', SEVERITY_DOT[finding.severity])}
          />
          <span className="sr-only">{finding.severity}: </span>
          <span className="line-clamp-2 min-w-0 text-xs leading-snug font-medium text-fg">
            {finding.message}
          </span>
        </span>
        {/* The location is the thing you actually navigate by, so it leads — and it is monospace,
            because file:line is code, and proportional digits in a scanning column are noise. */}
        <span className="flex w-full min-w-0 items-center gap-1.5 pl-4">
          <span className="min-w-0 truncate font-mono text-[11px] text-fg-secondary">
            {basename(finding.location.file)}:{finding.location.startLine}
          </span>
          <span aria-hidden="true" className="shrink-0 text-border-strong">
            ·
          </span>
          <span className="min-w-0 truncate text-[11px] text-fg-muted">{finding.ruleId}</span>
        </span>
      </button>

      {/*
        Actions appear on hover, on keyboard focus, and on the selected row — never on all of them
        at once. Three buttons in every row of a long list is three buttons' worth of visual weight
        competing with the finding text itself, and rendering them permanently in a muted colour so
        they stop shouting just makes them look disabled instead (which is exactly how they read).
        Revealing them is the pattern Linear uses for row actions and VS Code for tree actions.
      */}
      <div
        className={cn(
          'flex flex-wrap items-center gap-1 pl-4',
          'transition-opacity duration-(--fx-motion-duration-fast) ease-(--ease-entrance)',
          'opacity-0 group-hover/row:opacity-100 group-focus-within/row:opacity-100',
          isSelected && 'opacity-100',
        )}
      >
        {aiConfigured ? (
          AI_ACTIONS.map((action) => (
            <button
              key={action.profile}
              type="button"
              disabled={aiBusy}
              onClick={() => void runAi(action.profile, finding.id)}
              className="shrink-0 rounded-md border border-border-strong bg-raised px-2 py-0.5 text-[11px] font-medium text-fg-secondary transition-colors duration-(--fx-motion-duration-fast) hover:border-accent-border hover:bg-hover hover:text-fg disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus-ring focus-visible:outline"
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
          className="ml-auto shrink-0 rounded px-2 py-0.5 text-[11px] text-fg-muted hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus-ring focus-visible:outline"
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
        icon={<FolderIcon className="size-5 text-fg-muted" />}
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
        icon={<AlertIcon className="size-5 text-fg-muted" />}
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
    <Centered
      icon={<CheckIcon className="size-5 text-success-text" />}
      tone="success"
      title="No problems found"
      body="Your code passed every check Fixora ran. Re-run after you make changes."
    />
  );
}

/**
 * The shared empty state. Every one of these used to be two lines of centred text floating in a
 * void — technically informative, visually indistinguishable from a panel that had failed to load.
 * An icon in a tinted plate gives the block a centre of gravity and tells you at a glance which
 * kind of empty this is: a success (nothing wrong), or a prompt (something for you to do).
 */
function Centered({
  title,
  body,
  action,
  icon,
  tone = 'neutral',
}: {
  title: string;
  body: string;
  action?: React.ReactNode;
  icon?: React.ReactNode;
  tone?: 'neutral' | 'success';
}): React.JSX.Element {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
      {icon !== undefined && (
        <span
          className={cn(
            'flex size-10 items-center justify-center rounded-full',
            tone === 'success' ? 'bg-success-subtle' : 'bg-inset',
          )}
        >
          {icon}
        </span>
      )}
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium text-fg">{title}</p>
        <p className="max-w-xs text-xs leading-relaxed text-fg-muted">{body}</p>
      </div>
      {action !== undefined && <div className="mt-0.5">{action}</div>}
    </div>
  );
}
