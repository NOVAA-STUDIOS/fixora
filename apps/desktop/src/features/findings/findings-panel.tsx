import {
  categoryRank,
  countByCategory,
  countByExtension,
  FINDING_CATEGORY_LABEL,
  FINDING_CATEGORY_ORDER,
  type FindingCategory,
  isRepairAttemptable,
  repairStateFor,
  REPAIR_STATE_LABEL,
  REPAIR_STATE_REASON,
  type Finding,
  type Severity,
  type TaskProfile,
} from '@fixora/shared-types';
import { AlertIcon, Button, CheckIcon, FolderIcon, VirtualList, cn } from '@fixora/ui';
import { useEffect } from 'react';

import { useFindingRowEstimate } from '../../hooks/use-density-metrics.js';
import { basename } from '../../lib/path.js';
import { useAiStore } from '../../stores/ai-store.js';
import { useUiStore } from '../../stores/ui-store.js';
import { useCapability } from '../ai/use-capability.js';
import { useWorkspaceStore } from '../workspace/workspace-store.js';

import { useBulkRepairStore } from './bulk-repair-store.js';
import { useFindingsStore } from './findings-store.js';

/**
 * The findings panel (roadmap M3): the evidence layer made visible. Virtualised, filterable by
 * severity. Clicking a finding jumps to and highlights the exact line, and every finding carries its
 * rule, severity, and the actions a first-timer needs — Explain, Repair, Test — right there, no hover
 * required. Zero AI in the findings themselves; this is the moat with the LLM switched off.
 */

/** Category dot colours. Repairable is the accent (it is the actionable one); the rest are quiet. */
const CATEGORY_DOT: Record<FindingCategory, string> = {
  repairable: 'bg-accent',
  'manual-review': 'bg-warn',
  configuration: 'bg-info',
  information: 'bg-border-strong',
};

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
  const findingsSoFar = useFindingsStore((s) => s.findingsSoFar);
  const error = useFindingsStore((s) => s.error);
  const filter = useFindingsStore((s) => s.filter);
  const ignoredIds = useFindingsStore((s) => s.ignoredIds);
  const refresh = useFindingsStore((s) => s.refresh);
  const run = useFindingsStore((s) => s.run);
  const cancel = useFindingsStore((s) => s.cancel);
  const setFilter = useFindingsStore((s) => s.setFilter);
  const showIgnored = useFindingsStore((s) => s.showIgnored);
  const listen = useFindingsStore((s) => s.listen);
  const selectedId = useFindingsStore((s) => s.selectedId);
  const select = useFindingsStore((s) => s.select);

  const workspace = useWorkspaceStore((s) => s.workspace);
  const revealAt = useWorkspaceStore((s) => s.revealAt);
  const rowEstimate = useFindingRowEstimate();

  const bulkStatus = useBulkRepairStore((s) => s.status);
  const bulkTotal = useBulkRepairStore((s) => s.total);
  const bulkIndex = useBulkRepairStore((s) => s.index);
  const bulkSummary = useBulkRepairStore((s) => s.summary);
  const bulkStart = useBulkRepairStore((s) => s.start);
  const bulkCancel = useBulkRepairStore((s) => s.cancel);
  const bulkDismiss = useBulkRepairStore((s) => s.dismiss);

  useEffect(() => listen(), [listen]);
  useEffect(() => {
    if (workspace !== null) void refresh();
  }, [workspace, refresh]);

  // Clustered by category — actionable first — so the list reads as groups without changing which
  // findings are shown, and without interleaving header rows into `VirtualList`, whose roving-focus
  // and selection contract assumes every row is a selectable finding. A stable sort keeps the
  // analyzer's own ordering inside each group.
  const visible = findings
    .filter((f) => !ignoredIds.includes(f.id))
    .slice()
    .sort((a, b) => categoryRank(a) - categoryRank(b));
  const categoryCounts = countByCategory(visible);
  // Same list the panel shows: ignored findings are excluded, so the breakdown always agrees with
  // the rows below it and re-derives on every run, ignore and applied fix.
  const extensionCounts = countByExtension(visible);
  const hiddenHere = findings.length - visible.length;

  // One click, or Enter/Space on the keyboard-active row, does the whole job: describe it, open
  // it, jump to it, highlight it. Defined once and handed to both `VirtualList` (keyboard) and
  // `FindingRow` (mouse), so there is exactly one place "activating a finding" is defined (beta
  // audit A4 remediation).
  const activate = (finding: Finding): void => {
    select(finding.id);
    revealAt(finding.location);
  };

  // Server-side truncation (`repositories.ts`'s `list()` defaults to `limit = 500`) must never
  // silently disagree with the counts the panel itself displays (beta audit A4, Trustworthiness
  // finding). `summary` is the true, unfiltered-by-limit count for whichever severity the current
  // filter names (or the grand total for "All") — if the fetched page came back shorter than that,
  // some matching findings exist that are not, and cannot be, shown below.
  const totalForFilter =
    filter.severity !== undefined ? summary?.bySeverity[filter.severity] : summary?.total;
  const isTruncated = totalForFilter !== undefined && findings.length < totalForFilter;

  return (
    <section
      aria-label="Problems"
      className="flex h-full min-w-0 flex-col overflow-hidden rounded-lg border border-border-subtle bg-raised"
    >
      <header className="flex h-9 shrink-0 items-center justify-between gap-2 border-b border-border-subtle px-3">
        <h2 className="shrink-0 text-[11px] font-semibold uppercase tracking-wider text-fg-secondary">
          Problems
        </h2>
        {/*
          File-type breakdown, on the heading's own line. `min-w-0` + `overflow-hidden` so a project
          spanning many languages shortens this list rather than pushing Re-run off the header —
          the button is the control, and it stays reachable at any width.
        */}
        {extensionCounts.length > 0 && (
          <ul
            aria-label="Problems by file type"
            className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden"
          >
            {extensionCounts.map(({ extension, count }) => (
              <li
                key={extension}
                className="shrink-0 text-[11px] tabular-nums whitespace-nowrap text-fg-muted"
              >
                <span className="font-mono">{extension}</span>
                {': '}
                <span className="font-medium text-fg-secondary">{count}</span>
              </li>
            ))}
          </ul>
        )}
        {bulkStatus === 'running' ? (
          <Button variant="ghost" size="sm" className="shrink-0" onClick={bulkCancel}>
            Cancel
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            className="shrink-0"
            onClick={() => void bulkStart(visible)}
            disabled={
              workspace === null ||
              status === 'running' ||
              !visible.some((f) => isRepairAttemptable(repairStateFor(f)))
            }
          >
            Repair All Repairable
          </Button>
        )}
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
            disabled={workspace === null || bulkStatus === 'running'}
          >
            {summary === null ? 'Run analysis' : 'Re-run'}
          </Button>
        )}
      </header>

      {bulkStatus === 'running' && (
        <div
          role="status"
          className="flex shrink-0 items-center justify-between gap-2 border-b border-border-subtle bg-inset px-3 py-2"
        >
          <p className="text-xs text-fg-secondary">
            Repairing {bulkIndex}/{bulkTotal}
            {bulkIndex > 0 && bulkTotal > 0 ? '…' : ''}
          </p>
          <Button variant="ghost" size="sm" onClick={bulkCancel}>
            Cancel
          </Button>
        </div>
      )}
      {bulkStatus === 'done' && bulkSummary !== null && (
        <div
          role="status"
          className="flex shrink-0 items-center justify-between gap-2 border-b border-border-subtle bg-inset px-3 py-2"
        >
          <p className="text-xs text-fg-secondary">
            {bulkSummary.repaired} repaired, {bulkSummary.skipped} skipped, {bulkSummary.failed} failed
          </p>
          <Button variant="ghost" size="sm" onClick={bulkDismiss}>
            Dismiss
          </Button>
        </div>
      )}

      {/*
        A failed run must never fall through silently to a generic empty state or leave stale
        results looking current (beta audit A4, Error states finding). Shown regardless of whether
        `visible` is empty or still holds a previous run's findings — `run()` clears `error` the
        instant a retry starts, so this disappears on its own rather than needing to be dismissed.
      */}
      {status === 'error' && error !== null && (
        <div
          role="alert"
          className="flex shrink-0 items-start gap-2 border-b border-border-subtle bg-danger-subtle px-3 py-2"
        >
          <AlertIcon className="mt-0.5 size-4 shrink-0 text-danger-text" />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <p className="text-xs font-medium text-danger-text">Analysis failed</p>
            <p className="text-xs leading-relaxed text-fg-secondary">{error}</p>
          </div>
          <Button variant="ghost" size="sm" className="shrink-0" onClick={() => void run()}>
            Try again
          </Button>
        </div>
      )}

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

      {/*
        The backend caps a single page at 10,000 rows (`repositories.ts`'s `list()` — raised from
        500, which a real project's finding count could actually reach); `summary` is the true,
        unlimited count. Past that cap the two would silently disagree — "N problems" in the filter
        tabs above claiming more than this list can actually scroll to (beta audit A4,
        Trustworthiness finding) — so say so explicitly rather than let the mismatch go unremarked.
      */}
      {isTruncated && (
        <p className="shrink-0 border-b border-border-subtle bg-inset px-3 py-1.5 text-[11px] text-fg-muted">
          Showing {findings.length} of {totalForFilter} problems. Narrow by severity to see the
          rest.
        </p>
      )}

      {/*
        What the list is made of, before you scroll it. The per-row badge already says what a single
        finding is; this says what the whole set is — "5 of these need a package installed, not a
        repair" is the thing that was invisible when everything rendered as one undifferentiated
        list. Counts only: filtering stays owned by the severity tabs above, so this adds a reading
        aid without adding a second, competing filter model.
      */}
      {visible.length > 0 && (
        <div
          className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-border-subtle px-3 py-1.5"
          aria-label="Problems by category"
        >
          {FINDING_CATEGORY_ORDER.filter((c) => categoryCounts[c] > 0).map((category) => (
            <span key={category} className="flex items-center gap-1.5 text-[11px]">
              <span
                aria-hidden="true"
                className={cn('size-1.5 rounded-full', CATEGORY_DOT[category])}
              />
              <span className="text-fg-secondary">{FINDING_CATEGORY_LABEL[category]}</span>
              <span className="tabular-nums text-fg-muted">{categoryCounts[category]}</span>
            </span>
          ))}
        </div>
      )}

      {visible.length === 0 ? (
        <EmptyState
          status={status}
          findingsSoFar={findingsSoFar}
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
          // Enter/Space on the keyboard-roving active row now activates it — this list carries the
          // same `listbox`/`option` ARIA contract the file tree does, and until now was the one
          // consumer that never wired the keyboard half of it (beta audit A4, Keyboard navigation
          // finding; the fix mirrors file-tree.tsx's `onActivate` wiring exactly).
          onActivate={activate}
          renderItem={(finding) => (
            <FindingRow
              finding={finding}
              onActivate={() => {
                activate(finding);
              }}
            />
          )}
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

function FindingRow({
  finding,
  onActivate,
}: {
  finding: Finding;
  onActivate: () => void;
}): React.JSX.Element {
  const ignore = useFindingsStore((s) => s.ignore);
  const isSelected = useFindingsStore((s) => s.selectedId === finding.id);
  const runAi = useAiStore((s) => s.run);
  const aiConfigured = useAiStore((s) => s.config?.configured ?? false);
  const aiBusy = useAiStore((s) => s.status === 'running');
  const setActiveView = useUiStore((s) => s.setActiveView);
  const capabilities = {
    explain: useCapability('explain'),
    repair: useCapability('repair', finding.repair),
    test: useCapability('test'),
  };
  // The four-state model (Issue 2/5). `finding.repair` alone could not distinguish "no fix for this
  // rule" from "no support for this file type"; both rendered as the same dead control.
  const repairState = repairStateFor(finding);

  return (
    <div
      className={cn(
        // The row is measured, so it sizes to its own content and the list makes room for it — no
        // h-full to fill a fixed slot, and no overflow-hidden, which would have clipped exactly the
        // content the measurement exists to accommodate. min-w-0 keeps it shrinking with the pane.
        // Spacing comes from the density tokens, not fixed utilities. The card is a STACK, so its
        // density lives in its own padding and gap — `--fx-row-height` sizes single-line rows and
        // says nothing about a card that holds three lines. Hardcoding `px-3 py-2` here is why the
        // toggle changed the chrome around the list and left the list itself untouched.
        'group/row flex min-w-0 flex-col border-b border-border-subtle',
        'gap-(--fx-card-gap) px-(--fx-card-padding-x) py-(--fx-card-padding-y)',
        'transition-colors duration-(--fx-motion-duration-fast) ease-(--ease-entrance)',
        !isSelected && 'hover:bg-hover',
        // The selected row is what the details pane is describing — say so, with a bar rather than a
        // fill, so the severity colours stay the loudest thing in the list.
        isSelected && 'bg-hover shadow-[inset_2px_0_0_0_var(--fx-color-accent)]',
      )}
    >
      <button
        type="button"
        // Not a tab stop of its own — `VirtualList`'s container is the single stop, and arrow keys
        // move a roving `aria-activedescendant` instead (beta audit A4, mirroring the file tree's
        // fixed pattern exactly). A click still activates the row directly.
        tabIndex={-1}
        onClick={onActivate}
        aria-current={isSelected}
        // The clamped message is still readable in full on hover, without opening the details pane.
        title={`${finding.message}\n${finding.location.file}:${String(finding.location.startLine)} — click for details`}
        className="flex w-full min-w-0 flex-col items-start gap-1 text-left"
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
          {/*
            The title is the loudest thing in the row. It was `text-xs` — the same size as the
            location beneath it — so the row read as two equal lines and the eye had nothing to land
            on when scanning. It is the sentence that says what is wrong, so it leads.
          */}
          <span className="line-clamp-2 min-w-0 text-[13px] leading-snug font-semibold text-fg">
            {finding.message}
          </span>
        </span>
        {/*
          Secondary line: where it is, and which rule fired. Deliberately quieter than the title.
          `file:line` stays monospace because it is code and proportional digits are noise in a
          scanning column; the rule id becomes a BADGE so it reads as a label rather than as more
          prose competing with the location.
        */}
        <span className="flex w-full min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 pl-4">
          <span className="min-w-0 truncate font-mono text-[11px] text-fg-secondary">
            {basename(finding.location.file)}:{finding.location.startLine}
          </span>
          <span className="shrink-0 rounded bg-inset px-1 py-px font-mono text-[10px] leading-none text-fg-muted ring-1 ring-border-subtle ring-inset">
            {finding.ruleId}
          </span>
        </span>
      </button>

      {/*
        Actions appear on hover, on keyboard focus, and on the selected row — never on all of them
        at once. Three buttons in every row of a long list is three buttons' worth of visual weight
        competing with the finding text itself, and rendering them permanently in a muted colour so
        they stop shouting just makes them look disabled instead (which is exactly how they read).
        Revealing them is the pattern Linear uses for row actions and VS Code for tree actions.
      */}
      {/*
        ISSUE 2/6: this row used to be `opacity-0` until hover, focus, or selection. A mouse user who
        was not hovering saw NO Repair button at all — the reported "missing Repair button". It is
        permanently visible now. The buttons still de-emphasise until the row is engaged (muted, not
        hidden), so a long list does not become three buttons of visual weight per row, but the
        control is always THERE and always says what it will do.
      */}
      <div
        className={cn(
          // `min-w-0` so the row may shrink below its content's natural width instead of forcing the
          // card wider than the pane — the clipping this sprint is about. `gap-y` is explicit so a
          // wrapped second line has breathing room rather than colliding with the line above it.
          'flex min-w-0 flex-wrap items-center gap-x-1 gap-y-1 pl-4',
          'transition-opacity duration-(--fx-motion-duration-fast) ease-(--ease-entrance)',
          isSelected
            ? 'opacity-100'
            : 'opacity-70 group-hover/row:opacity-100 group-focus-within/row:opacity-100',
        )}
      >
        {/* The repair state, always readable without hovering anything. */}
        <span
          title={REPAIR_STATE_REASON[repairState]}
          className={cn(
            'shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium',
            repairState === 'repairable' && 'bg-success-subtle text-success-text',
            repairState === 'ai-repairable' && 'bg-accent-subtle text-accent-text',
            repairState === 'manual-only' && 'bg-inset text-fg-muted',
            repairState === 'unsupported' && 'bg-inset text-fg-muted',
          )}
        >
          {REPAIR_STATE_LABEL[repairState]}
        </span>
        {aiConfigured ? (
          AI_ACTIONS.map((action) => {
            // Repair carries the four-state reason; the other profiles keep the model-capability one.
            const blockedByState =
              action.profile === 'repair' &&
              repairState !== 'manual-only' &&
              !isRepairAttemptable(repairState);
            const capability = capabilities[action.profile];
            const disabled = aiBusy || !capability.enabled || blockedByState;
            return (
              <button
                key={action.profile}
                type="button"
                // Disabled — never hidden. A control that vanishes cannot explain itself; a disabled
                // one with a reason can, which is the distinction Issue 2 turns on.
                disabled={disabled}
                title={
                  blockedByState
                    ? REPAIR_STATE_REASON[repairState]
                    : capability.enabled
                      ? undefined
                      : capability.reason
                }
                onClick={() => void runAi(action.profile, finding.id)}
                className="shrink-0 rounded-md border border-border-strong bg-raised px-2 py-0.5 text-[11px] font-medium text-fg-secondary transition-colors duration-(--fx-motion-duration-fast) hover:border-accent-border hover:bg-hover hover:text-fg disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus-ring focus-visible:outline"
              >
                {action.label}
              </button>
            );
          })
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
          /*
            `ml-auto` pushed this to the far right, which is right on one line and wrong the moment
            the row wraps: on a narrow pane the auto-margin threw it to the end of a new line with a
            gap of dead space beside the buttons it was meant to sit after. It now simply follows
            them, and the wrap is what handles a narrow pane — which is the point of `flex-wrap`.
          */
          className="shrink-0 rounded px-2 py-0.5 text-[11px] text-fg-muted hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus-ring focus-visible:outline"
        >
          Ignore
        </button>
      </div>
    </div>
  );
}

function EmptyState({
  status,
  findingsSoFar,
  hasWorkspace,
  summary,
  filterActive,
  allHidden,
  onRun,
  onShowAll,
  onShowHidden,
}: {
  status: string;
  findingsSoFar: number | null;
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
      <Centered
        title="Analyzing…"
        body={
          findingsSoFar === null
            ? 'Running your linters and type-checker on this project.'
            : // Proof of life on a large project: a multi-minute run with no visible change reads
              // as frozen, not as working. Updates as findings stream in, well before the run ends.
              `${String(findingsSoFar)} problem${findingsSoFar === 1 ? '' : 's'} found so far — still running.`
        }
      />
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
