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
import {
  AlertIcon,
  Button,
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CloseIcon,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  FolderIcon,
  SearchIcon,
  VirtualList,
  cn,
} from '@fixora/ui';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useFindingRowEstimate } from '../../hooks/use-density-metrics.js';
import { invoke } from '../../lib/bridge.js';
import { basename } from '../../lib/path.js';
import { useAiStore } from '../../stores/ai-store.js';
import { usePreviewStore } from '../../stores/preview-store.js';
import { toast } from '../../stores/toast-store.js';
import { useUiStore } from '../../stores/ui-store.js';
import { useCapability } from '../ai/use-capability.js';
import { useWorkspaceStore } from '../workspace/workspace-store.js';

import { useBulkRepairStore } from './bulk-repair-store.js';
import { useFindingsStore } from './findings-store.js';
import { GroupedRepairPanel } from './grouped-repair-panel.js';

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

/** A flat, virtualizable projection of `groups` — one entry per header and per visible row, so
 *  grouped mode (file/severity) can go through the same `VirtualList` flat mode already uses,
 *  instead of rendering every row into the DOM at once. */
type VirtualItem =
  | { kind: 'header'; groupKey: string; label: string; count: number; isCollapsed: boolean }
  | { kind: 'row'; finding: Finding; groupKey: string };

type GroupMode = 'flat' | 'file' | 'severity';
const GROUP_MODES: { mode: GroupMode; label: string; icon: string }[] = [
  { mode: 'flat', label: 'Flat', icon: '≡' },
  { mode: 'file', label: 'File', icon: '📄' },
  { mode: 'severity', label: 'Severity', icon: '⚠' },
];

/** Coarse enough to be honest about an estimate, not a countdown: "~1m" not "58s". */
function formatEta(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) return `~${String(totalSeconds)}s`;
  return `~${String(Math.round(totalSeconds / 60))}m`;
}

const SEVERITY_ORDER: Severity[] = ['error', 'warning', 'info'];
const SEVERITY_STYLE: Record<Severity, string> = {
  error: 'text-danger-text',
  warning: 'text-warn-text',
  info: 'text-fg-muted',
};
/** The left border accent — VS Code's Problems panel pattern. Carries severity on the row's edge
 *  instead of a dot competing with the text for the reader's first glance. */
const SEVERITY_BORDER: Record<Severity, string> = {
  error: 'border-l-danger',
  warning: 'border-l-warn',
  info: 'border-l-border-strong',
};
/**
 * A coarse severity label for security findings, in the vocabulary a security reviewer expects
 * (Critical/Medium/Low) — NOT a real CVSS score, since nothing in the analyzer pipeline computes
 * one (no rule carries CVSS metadata today). Derived from the same three-level `finding.severity`
 * every other finding already has, so this is a relabelling for the security context, not a new
 * signal invented for it.
 */
function securitySeverityLabel(severity: Severity): 'Critical' | 'Medium' | 'Low' {
  if (severity === 'error') return 'Critical';
  if (severity === 'warning') return 'Medium';
  return 'Low';
}

/** Findings are sorted by `categoryRank` (below) inside each of these buckets — security first,
 * ranked by its own severity, ahead of everything else regardless of that finding's own category. */
function securityPriorityRank(finding: Finding): number {
  if (finding.category !== 'security') return finding.severity === 'error' ? 2 : 3;
  return finding.severity === 'error' ? 0 : 1;
}

/** Repair-state icon, paired with the existing badge colour — not a new colour, a label for it. */
const REPAIR_STATE_ICON: Record<ReturnType<typeof repairStateFor>, string> = {
  repairable: '⚡',
  'ai-repairable': '🤖',
  'manual-only': '👁',
  unsupported: '✗',
  'config-issue': '✗',
};

export function FindingsPanel(): React.JSX.Element {
  const findings = useFindingsStore((s) => s.findings);
  const summary = useFindingsStore((s) => s.summary);
  const status = useFindingsStore((s) => s.status);
  const findingsSoFar = useFindingsStore((s) => s.findingsSoFar);
  const error = useFindingsStore((s) => s.error);
  const warnings = useFindingsStore((s) => s.warnings);
  const skippedFiles = useFindingsStore((s) => s.skippedFiles);
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
  const [searchQuery, setSearchQuery] = useState('');
  const [groupMode, setGroupMode] = useState<GroupMode>('flat');
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const toggleGroup = (key: string): void => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const workspace = useWorkspaceStore((s) => s.workspace);
  const revealAt = useWorkspaceStore((s) => s.revealAt);
  const rowEstimate = useFindingRowEstimate();

  const bulkStatus = useBulkRepairStore((s) => s.status);
  const bulkTotal = useBulkRepairStore((s) => s.total);
  const bulkIndex = useBulkRepairStore((s) => s.index);
  const bulkCurrentLabel = useBulkRepairStore((s) => s.currentFindingLabel);
  const bulkEtaMs = useBulkRepairStore((s) => s.etaMs);
  const bulkProgress = useBulkRepairStore((s) => s.progress);
  const bulkSummary = useBulkRepairStore((s) => s.summary);
  const bulkStart = useBulkRepairStore((s) => s.start);
  const bulkCancel = useBulkRepairStore((s) => s.cancel);
  const bulkDismiss = useBulkRepairStore((s) => s.dismiss);
  const groupedRepair = useBulkRepairStore((s) => s.groupedRepair);
  const [groupRepairOpen, setGroupRepairOpen] = useState(false);

  const [skippedBannerDismissed, setSkippedBannerDismissed] = useState(false);

  useEffect(() => listen(), [listen]);
  useEffect(() => {
    if (workspace !== null) void refresh();
  }, [workspace, refresh]);
  // A fresh run's own skippedFiles (or absence of any) should always get a fresh banner — never
  // suppressed by a dismissal left over from a previous run.
  useEffect(() => {
    if (status === 'running') setSkippedBannerDismissed(false);
  }, [status]);

  // `VirtualList`'s remount key (below) — bumped only on the events that actually change what a
  // row's measured height should be (a finished run, a finished bulk repair, a group-mode switch,
  // a repair applied to one finding — findings.length changes either way a repair resolves: the
  // finding is removed once fixed, or stays with an updated state), never on every finding
  // streamed in mid-run. Booleans, not `status`/`bulkStatus` themselves, so this doesn't also fire
  // on every OTHER status transition (e.g. idle → running).
  const [listKey, setListKey] = useState(0);
  useEffect(() => {
    if (status === 'running') return; // Don't remount during streaming
    setListKey((k) => k + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberately boolean, not status/bulkStatus
  }, [status === 'done', bulkStatus === 'done', groupMode, findings.length, status]);

  // Clustered by category — actionable first — so the list reads as groups without changing which
  // findings are shown, and without interleaving header rows into `VirtualList`, whose roving-focus
  // and selection contract assumes every row is a selectable finding. A stable sort keeps the
  // analyzer's own ordering inside each group.
  // Memoized: with 1000+ findings, `.filter().slice().sort()` is real work, and without this it ran
  // on EVERY render — including a keystroke in the search box, which touches unrelated local state
  // and previously re-derived this whole chain (and every downstream `VirtualList` row) for nothing.
  const visible = useMemo(
    () =>
      findings
        .filter((f) => !ignoredIds.includes(f.id))
        .slice()
        // Security first (its own errors ahead of its own warnings), then the existing
        // repairable-first grouping inside every other bucket — security priority layers on top
        // of, rather than replaces, the sort the rest of the panel already relies on.
        .sort(
          (a, b) => securityPriorityRank(a) - securityPriorityRank(b) || categoryRank(a) - categoryRank(b),
        ),
    [findings, ignoredIds],
  );

  const exportFindings = useCallback(
    async (format: 'json' | 'csv'): Promise<void> => {
      const date = new Date().toISOString().slice(0, 10);
      const filename = `fixora-findings-${date}.${format}`;
      const rows = visible.map((f) => ({
        message: f.message,
        rule: f.ruleId,
        severity: f.severity,
        file: f.location.file,
        line: f.location.startLine,
      }));
      const content =
        format === 'json'
          ? JSON.stringify(rows, null, 2)
          : [
              'message,rule,severity,file,line',
              ...rows.map((r) =>
                [r.message, r.rule, r.severity, r.file, String(r.line)]
                  .map((v) => `"${v.replace(/"/g, '""')}"`)
                  .join(','),
              ),
            ].join('\n');
      const result = await invoke('fs:writeFile', { relPath: filename, content });
      if (result.ok) {
        toast.success(`Findings exported to ${filename}`);
      } else {
        toast.error("Couldn't export findings.", result.error.message);
      }
    },
    [visible],
  );
  const categoryCounts = countByCategory(visible);
  // Same list the panel shows: ignored findings are excluded, so the breakdown always agrees with
  // the rows below it and re-derives on every run, ignore and applied fix.
  const extensionCounts = countByExtension(visible);
  const hiddenHere = findings.length - visible.length;
  const securityFindings = useMemo(
    () => visible.filter((f) => f.category === 'security'),
    [visible],
  );

  // Text search is local, client-side state — it narrows the already-fetched page (severity stays
  // the server-side filter via `setFilter`) rather than round-tripping to the backend, so typing
  // feels instant and no store/IPC contract changes for a feature this size.
  const trimmedQuery = searchQuery.trim().toLowerCase();
  const searched = useMemo(
    () =>
      trimmedQuery === ''
        ? visible
        : visible.filter(
            (f) =>
              f.message.toLowerCase().includes(trimmedQuery) ||
              f.ruleId.toLowerCase().includes(trimmedQuery) ||
              f.location.file.toLowerCase().includes(trimmedQuery),
          ),
    [visible, trimmedQuery],
  );

  // While a run is streaming, `searched` changes on every flush (findings-store.ts's FLUSH_MS) —
  // feeding that straight into `VirtualList` would remeasure/reflow the list every 500ms for
  // nothing the user asked to see mid-run. Freeze what the list renders at whatever `searched` was
  // the moment `status` last left 'running'; the header's own counts still read live state.
  const isRunning = status === 'running';
  const stableFindings = useRef(searched);
  if (!isRunning) stableFindings.current = searched;
  const displayFindings = isRunning ? stableFindings.current : searched;

  // Grouping is local display state, applied last — on top of severity (server) and search
  // (above), so all three compose. Flat keeps the existing `VirtualList` path untouched below;
  // File/Severity render as plain collapsible sections instead, because `VirtualList`'s roving-
  // focus/selection contract assumes every row is a selectable finding (see the categoryRank sort
  // comment above) — interleaving header rows into it was already ruled out for that reason.
  const groups: { key: string; label: string; findings: Finding[] }[] = useMemo(
    () =>
      groupMode === 'flat'
        ? []
        : groupMode === 'severity'
          ? SEVERITY_ORDER.map((sev) => ({
              key: sev,
              label: sev,
              findings: displayFindings.filter((f) => f.severity === sev),
            })).filter((g) => g.findings.length > 0)
          : Object.entries(
              displayFindings.reduce<Record<string, Finding[]>>((acc, f) => {
                const key = basename(f.location.file);
                (acc[key] ??= []).push(f);
                return acc;
              }, {}),
            )
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([key, groupFindings]) => ({ key, label: key, findings: groupFindings })),
    [groupMode, displayFindings],
  );

  // Grouped mode now renders through `VirtualList` too (below), which owns the roving
  // `aria-activedescendant`/keyboard contract itself — headers and rows are flattened into one
  // list so the virtualizer sees a single, uniform sequence of items.
  const virtualItems = useMemo(() => {
    const items: VirtualItem[] = [];
    for (const group of groups) {
      const isCollapsed = collapsedGroups.has(group.key);
      items.push({
        kind: 'header',
        groupKey: group.key,
        label: group.label,
        count: group.findings.length,
        isCollapsed,
      });
      if (!isCollapsed) {
        for (const finding of group.findings) {
          items.push({ kind: 'row', finding, groupKey: group.key });
        }
      }
    }
    return items;
  }, [groups, collapsedGroups]);

  // One click, or Enter/Space on the keyboard-active row, does the whole job: describe it, open
  // it, jump to it, highlight it. Defined once and handed to both `VirtualList` (keyboard) and
  // `FindingRow` (mouse), so there is exactly one place "activating a finding" is defined (beta
  // audit A4 remediation).
  // `useCallback`, not a plain closure: this is passed to every visible `FindingRow` as `onActivate`.
  // A fresh function identity every render would defeat `React.memo` on `FindingRow` below — the row
  // props would never be referentially equal, so every row would re-render on any parent state
  // change (a search keystroke, a store update) regardless of whether that row's own data changed.
  const activate = useCallback(
    (finding: Finding): void => {
      select(finding.id);
      revealAt({ ...finding.location, severity: finding.severity });
    },
    [select, revealAt],
  );

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
      className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-canvas"
    >
      <header className="flex flex-col shrink-0 border-b border-border-subtle bg-raised">
        <div className="flex h-8 items-center justify-between gap-2 px-3">
          <h2 className="shrink-0 font-[system-ui] text-[10px] font-semibold tracking-[0.08em] text-fg-muted uppercase">
            Problems
          </h2>
          {/*
            File-type breakdown, on the heading's own line. `min-w-0` so a project spanning many
            languages shrinks this list rather than pushing Re-run off the header — the button is the
            control, and it stays reachable at any width. Scrollable, not clipped: each chip is
            `shrink-0` already, so `overflow-hidden` here did not hide whole chips at the boundary —
            it clipped mid-text whichever chip happened to straddle it. `overflow-x-auto` keeps every
            chip intact; a narrow panel scrolls the row instead of truncating one.
          */}
          {extensionCounts.length > 0 && (
            <ul
              aria-label="Problems by file type"
              className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto"
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
          {status === 'running' ? (
            <Button
              variant="ghost"
              size="sm"
              className="shrink-0"
              onClick={() => {
                void cancel();
              }}
            >
              Cancel
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              className="shrink-0"
              onClick={() => {
                void run();
              }}
              disabled={workspace === null || bulkStatus === 'running'}
            >
              {summary === null ? 'Run analysis' : 'Re-run'}
            </Button>
          )}
        </div>

        {workspace !== null && visible.length > 0 && (
          <div className="flex flex-wrap items-center gap-1 border-t border-border-subtle px-2 py-1">
            {bulkStatus === 'running' ? (
              <Button variant="ghost" size="sm" className="shrink-0 text-xs" onClick={bulkCancel}>
                Cancel
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                className="shrink-0 text-xs"
                onClick={() => {
                  void bulkStart(visible);
                }}
                disabled={
                  status === 'running' ||
                  // Bulk also attempts manual-only findings (via allowManual — see bulk-repair-store.ts),
                  // so the button stays enabled for those too, not just the strictly repairable ones.
                  !visible.some((f) => {
                    const state = repairStateFor(f);
                    return isRepairAttemptable(state) || state === 'manual-only';
                  })
                }
              >
                Repair All Repairable
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="shrink-0 text-xs">
                  Export
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => void exportFindings('json')}>
                  Export as JSON
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => void exportFindings('csv')}>
                  Export as CSV
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              variant="ghost"
              size="sm"
              className="shrink-0 text-xs"
              onClick={() => {
                setGroupRepairOpen(true);
              }}
            >
              Group Repair
            </Button>
          </div>
        )}
      </header>

      <div className="flex flex-col shrink-0 overflow-y-auto" style={{ maxHeight: '40%' }}>
      {bulkStatus === 'running' && (
        <div
          role="status"
          className="flex shrink-0 items-center justify-between gap-2 border-b border-border-subtle bg-inset px-3 py-2"
        >
          <p className="min-w-0 truncate text-xs text-fg-secondary">
            Repairing {bulkIndex} of {bulkTotal}
            {bulkCurrentLabel !== null ? ` — ${bulkCurrentLabel}` : ''}
            {bulkEtaMs !== null && bulkEtaMs > 0 ? ` (${formatEta(bulkEtaMs)} left)` : ''} (
            {bulkProgress.repaired} repaired, {bulkProgress.failed} failed so far)
          </p>
          <Button variant="ghost" size="sm" onClick={bulkCancel}>
            Cancel
          </Button>
        </div>
      )}
      {bulkStatus === 'done' && bulkSummary !== null && (
        <div
          role="status"
          className="flex shrink-0 flex-col gap-1 border-b border-border-subtle bg-inset px-3 py-2"
        >
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-fg-secondary">
              {bulkSummary.repaired} repaired, {bulkSummary.skipped} skipped, {bulkSummary.failed} failed
              {bulkSummary.needsManualFix.length > 0 &&
                ` (${String(bulkSummary.needsManualFix.length)} need manual fix)`}
              {bulkSummary.repaired > 0 &&
                (status === 'running' ? ' — re-analyzing…' : ` — ${String(summary?.total ?? 0)} remaining`)}
            </p>
            <Button variant="ghost" size="sm" onClick={bulkDismiss}>
              Dismiss
            </Button>
          </div>
          {bulkSummary.needsManualFix.length > 0 && (
            <ul className="flex flex-col gap-0.5">
              {bulkSummary.needsManualFix.slice(0, 5).map((f) => (
                <li key={f.findingId} className="text-[11px] text-fg-muted">
                  <span className="font-mono">{f.ruleId}</span>: {f.reason}
                </li>
              ))}
              {bulkSummary.needsManualFix.length > 5 && (
                <li className="text-[11px] text-fg-muted">
                  +{bulkSummary.needsManualFix.length - 5} more
                </li>
              )}
            </ul>
          )}
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

      {/*
        NOV7-01: a tool killed at its timeout must be visible, never silently converted to a clean
        "zero findings". `warnings` comes from the run's reliability notices; shown as a partial-
        analysis banner so the empty state below is never read as "your code is clean".
      */}
      {warnings !== null && warnings.length > 0 && (
        <div
          role="status"
          className="flex shrink-0 items-start gap-2 border-b border-border-subtle bg-warn-subtle px-3 py-2"
        >
          <AlertIcon className="mt-0.5 size-4 shrink-0 text-warn-text" />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <p className="text-xs font-medium text-warn-text">Analysis was partial</p>
            {warnings.map((w) => (
              <p key={`${w.analyzerId}-${w.tool}`} className="text-xs leading-relaxed text-fg-secondary">
                {w.message}
              </p>
            ))}
          </div>
        </div>
      )}

      {skippedFiles !== null && skippedFiles.length > 0 && !skippedBannerDismissed && (
        <div
          role="status"
          className="flex shrink-0 items-start gap-2 border-b border-border-subtle bg-warn-subtle px-3 py-2"
        >
          <AlertIcon className="mt-0.5 size-4 shrink-0 text-warn-text" />
          <p className="min-w-0 flex-1 text-xs leading-relaxed text-fg-secondary">
            ⚠️ {skippedFiles.length} file{skippedFiles.length === 1 ? '' : 's'} skipped (too large
            to analyze): {skippedFiles.slice(0, 3).map((f) => basename(f)).join(', ')}
            {skippedFiles.length > 3 ? ` and ${String(skippedFiles.length - 3)} more` : ''}
          </p>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => {
              setSkippedBannerDismissed(true);
            }}
            className="shrink-0 rounded p-0.5 text-fg-muted hover:bg-hover hover:text-fg"
          >
            <CloseIcon className="size-3.5" />
          </button>
        </div>
      )}
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-border-subtle bg-raised px-2 py-1.5">
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
        Search and Group-by used to share one `h-8` row; a full-width group-toggle (3 buttons, each
        icon+label) squeezed the search input's real width down far enough that its own placeholder
        went invisible before the row ever got close to visually "full" — the reported cut-off text.
        Two rows fixes both: the search bar gets its full width to breathe, and the toggle gets room
        to read as three distinct buttons instead of three cramped abbreviations.
      */}
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border-subtle bg-raised px-3">
        <SearchIcon className="size-3.5 shrink-0 text-fg-muted" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => {
            setSearchQuery(e.target.value);
          }}
          placeholder="Filter by message, rule, or file…"
          aria-label="Filter problems"
          className="min-w-0 flex-1 bg-transparent text-xs text-fg outline-none placeholder:text-fg-muted"
        />
        {searchQuery !== '' && (
          <button
            type="button"
            onClick={() => {
              setSearchQuery('');
            }}
            title="Clear filter"
            aria-label="Clear filter"
            className="shrink-0 rounded p-0.5 text-fg-muted hover:bg-hover hover:text-fg"
          >
            <CloseIcon className="size-3.5" />
          </button>
        )}
      </div>
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border-subtle bg-raised px-3">
        <span className="shrink-0 text-[10px] font-medium tracking-wide text-fg-muted uppercase">
          Group by
        </span>
        <div
          role="group"
          aria-label="Group by"
          className="flex shrink-0 items-center gap-1 rounded-md border border-border-subtle p-1"
        >
          {GROUP_MODES.map(({ mode, label, icon }) => (
            <button
              key={mode}
              type="button"
              onClick={() => {
                setGroupMode(mode);
              }}
              aria-pressed={groupMode === mode}
              title={`Group by ${label.toLowerCase()}`}
              className={cn(
                'rounded px-2.5 py-1 text-xs font-medium transition-colors',
                groupMode === mode
                  ? 'bg-accent-subtle text-accent-text'
                  : 'text-fg-muted hover:bg-hover hover:text-fg',
              )}
            >
              <span aria-hidden="true">{icon}</span> {label}
            </button>
          ))}
        </div>
      </div>
      {trimmedQuery !== '' && (
        <p className="shrink-0 border-b border-border-subtle bg-inset px-3 py-1.5 text-[11px] text-fg-muted">
          {searched.length} result{searched.length === 1 ? '' : 's'} for &lsquo;{searchQuery}&rsquo;
        </p>
      )}

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

      {securityFindings.length > 0 && (
        <div className="sticky top-0 z-10 flex shrink-0 items-center justify-between gap-3 border-b border-l-[3px] border-l-danger bg-danger-subtle px-3 py-2">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-xs font-semibold text-danger-text">
              🔒 Security Issues ({securityFindings.length})
            </p>
            <p className="text-[11px] text-fg-secondary">Address these first — highest risk.</p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="shrink-0"
            disabled={bulkStatus === 'running' || workspace === null}
            onClick={() => {
              console.error('[panel] onClick: Fix All Security');
              void groupedRepair('security', securityFindings);
            }}
          >
            Fix All Security
          </Button>
        </div>
      )}

      {searched.length === 0 ? (
        <EmptyState
          status={status}
          findingsSoFar={findingsSoFar}
          hasWorkspace={workspace !== null}
          summary={summary}
          filterActive={filter.severity !== undefined || trimmedQuery !== ''}
          allHidden={findings.length > 0 && visible.length === 0}
          onRun={() => void run()}
          onShowAll={() => {
            void setFilter({});
            setSearchQuery('');
          }}
          onShowHidden={showIgnored}
        />
      ) : groupMode !== 'flat' ? (
        <VirtualList
          key={`${groupMode}-${String(listKey)}`}
          items={virtualItems}
          label="Problems"
          estimateRowHeight={rowEstimate}
          dynamicRowHeight
          getKey={(item) => (item.kind === 'header' ? `header-${item.groupKey}` : `row-${item.finding.id}`)}
          isSelected={(item) => item.kind === 'row' && item.finding.id === selectedId}
          className="min-h-0 flex-1"
          // Headers and rows share one roving-focus sequence — Enter/Space toggles a header,
          // activates a row, exactly like a click on either would.
          onActivate={(item) => {
            if (item.kind === 'header') toggleGroup(item.groupKey);
            else activate(item.finding);
          }}
          renderItem={(item) => {
            if (item.kind === 'header') {
              return (
                <button
                  type="button"
                  onClick={() => {
                    toggleGroup(item.groupKey);
                  }}
                  aria-expanded={!item.isCollapsed}
                  // Not a tab stop: `VirtualList`'s container is the single tab stop for this list
                  // (headers included) — see its own doc comment on that contract.
                  tabIndex={-1}
                  className="sticky top-0 z-10 flex w-full items-center gap-1.5 border-b border-border-subtle bg-raised px-3 py-1.5 text-left hover:bg-hover"
                >
                  {item.isCollapsed ? (
                    <ChevronRightIcon className="size-3.5 shrink-0 text-fg-muted" />
                  ) : (
                    <ChevronDownIcon className="size-3.5 shrink-0 text-fg-muted" />
                  )}
                  <span
                    className={cn(
                      'min-w-0 truncate text-xs font-medium capitalize',
                      groupMode === 'severity'
                        ? SEVERITY_STYLE[item.groupKey as Severity]
                        : 'text-fg-secondary',
                    )}
                  >
                    {item.label}
                  </span>
                  <span className="tabular-nums text-[11px] text-fg-muted">
                    ({item.count} issue{item.count === 1 ? '' : 's'})
                  </span>
                </button>
              );
            }
            return <FindingRow finding={item.finding} onActivate={activate} />;
          }}
        />
      ) : (
        <VirtualList
          key={`${groupMode}-${String(listKey)}`}
          items={displayFindings}
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
          renderItem={(finding) => <FindingRow finding={finding} onActivate={activate} />}
        />
      )}
      <GroupedRepairPanel
        open={groupRepairOpen}
        onOpenChange={setGroupRepairOpen}
        findings={visible}
      />
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

const FindingRow = memo(function FindingRow({
  finding,
  onActivate,
  tabIndex = -1,
  rowRef,
  onKeyDown,
  onFocus,
}: {
  finding: Finding;
  // Takes the finding, not a pre-bound `() => void`: both call sites pass the panel's single
  // `useCallback`-stabilized `activate` directly, so the reference stays identical across renders —
  // required for this `memo()` wrapper to actually skip re-rendering rows whose own data hasn't
  // changed (a bound-per-row arrow function would be a new reference every render regardless).
  onActivate: (finding: Finding) => void;
  /**
   * Left at the default (-1) for `VirtualList`'s flat mode, whose own container is the single tab
   * stop (see the button's comment below). Grouped mode overrides it per-row for its own roving-
   * tabIndex pattern, since it has no such container.
   */
  tabIndex?: number;
  rowRef?: (el: HTMLButtonElement | null) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLButtonElement>) => void;
  onFocus?: () => void;
}): React.JSX.Element {
  const ignore = useFindingsStore((s) => s.ignore);
  const isSelected = useFindingsStore((s) => s.selectedId === finding.id);
  const runAi = useAiStore((s) => s.run);
  const setEditMode = useUiStore((s) => s.setEditMode);
  const aiConfigured = useAiStore((s) => s.config?.configured ?? false);
  const aiBusy = useAiStore((s) => s.status === 'running');
  const setActiveView = useUiStore((s) => s.setActiveView);
  const previewIsOpen = usePreviewStore((s) => s.isOpen);
  const capabilities = {
    explain: useCapability('explain'),
    repair: useCapability('repair', finding.repair),
    test: useCapability('test'),
  };
  // The four-state model (Issue 2/5). `finding.repair` alone could not distinguish "no fix for this
  // rule" from "no support for this file type"; both rendered as the same dead control.
  const repairState = repairStateFor(finding);
  // Belt to `aiBusy`'s braces: `aiBusy` only reflects the store *after* React re-renders this row
  // with the new `disabled` prop, so two clicks landing inside that window (a fast double-click,
  // or the app busy on a heavy list) could both fire `runAi`. This closes that window directly,
  // without waiting on a render — AI action buttons only, never Ignore or the filter controls.
  const lastAiClick = useRef(0);

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
        // iOS Premium: a rounded card with its own subtle border, not a full-bleed row — mx-1.5
        // insets it from the panel edges the same way the sidebar's active pill does, so the two
        // read as the same design language.
        'group/row mx-1.5 my-0.5 flex min-w-0 flex-col rounded-xl border border-white/[0.06]',
        // Severity accent on the left edge, not a dot inside it — one signal instead of two.
        // Security overrides it to the danger token regardless of the finding's own severity — a
        // security *warning* still reads as more urgent than a correctness *warning* does.
        'border-l-[3px] hover:brightness-125',
        finding.category === 'security' ? 'border-l-danger' : SEVERITY_BORDER[finding.severity],
        'gap-(--fx-card-gap) px-(--fx-card-padding-x) py-(--fx-card-padding-y)',
        // Only the properties that CANNOT change layout.
        //
        // This was `transition-all`, on a row the virtualizer measures with a ResizeObserver and
        // positions absolutely via `translateY`. Animating `all` means any height-affecting change
        // (a repair-state swap, a wrapping label) is measured mid-flight, so the virtualizer
        // computes offsets from a transient height and the next row is placed on top of this one —
        // the garbled, overlapping text during repair transitions. Colour and shadow cannot change
        // a row's height, so they are safe to animate; height and spacing must land instantly.
        'transition-[background-color,box-shadow,border-color,transform] duration-(--fx-motion-duration-fast) ease-(--ease-entrance)',
        'hover:translate-x-0.5',
        !isSelected &&
          (finding.category === 'security' ? 'hover:bg-danger-subtle' : 'hover:bg-white/[0.04]'),
        // The selected row is what the details pane is describing — say so, with a bar rather than a
        // fill, so the severity colours stay the loudest thing in the list.
        isSelected && 'bg-hover shadow-[inset_2px_0_0_0_var(--fx-color-accent)]',
      )}
    >
      <button
        type="button"
        ref={rowRef}
        // In flat mode (the default, `tabIndex={-1}`): not a tab stop of its own — `VirtualList`'s
        // container is the single stop, and arrow keys move a roving `aria-activedescendant`
        // instead (beta audit A4, mirroring the file tree's fixed pattern exactly). Grouped mode has
        // no such container, so it passes its own per-row roving value and key handler instead. A
        // click still activates the row directly either way.
        tabIndex={tabIndex}
        onClick={() => {
          onActivate(finding);
        }}
        onKeyDown={onKeyDown}
        onFocus={onFocus}
        aria-current={isSelected}
        // The clamped message is still readable in full on hover, without opening the details pane.
        title={`${finding.message}\n${finding.location.file}:${String(finding.location.startLine)} — click for details`}
        className="flex w-full min-w-0 flex-col items-start gap-1 text-left"
      >
        {/*
          TOP ROW: severity + rule, both small and muted — context, not the headline. The repair
          state moves up here too (right-aligned) so it reads with the row's other metadata instead
          of competing with the action buttons on the bottom row.
        */}
        <span className="flex w-full min-w-0 items-center gap-1.5">
          {finding.category === 'security' && (
            <>
              <span className="shrink-0 rounded bg-danger-subtle px-1.5 py-0.5 text-[10px] font-semibold text-danger-text">
                🔒 Security · {securitySeverityLabel(finding.severity)}
              </span>
              <span className="shrink-0 text-[10px] text-fg-muted" aria-hidden="true">
                ·
              </span>
            </>
          )}
          <span className={cn('shrink-0 text-[10px] font-semibold tracking-wide uppercase', SEVERITY_STYLE[finding.severity])}>
            {finding.severity}
          </span>
          <span className="shrink-0 text-[10px] text-fg-muted" aria-hidden="true">
            ·
          </span>
          <span className="min-w-0 truncate font-mono text-[10px] text-fg-muted">
            {finding.ruleId}
          </span>
          <span
            title={REPAIR_STATE_REASON[repairState]}
            className={cn(
              'ml-auto flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium',
              repairState === 'repairable' && 'bg-success-subtle text-success-text',
              repairState === 'ai-repairable' && 'bg-accent-subtle text-accent-text',
              repairState === 'manual-only' && 'bg-warn-subtle text-warn-text',
              repairState === 'unsupported' && 'bg-inset text-fg-muted',
            )}
          >
            <span aria-hidden="true">{REPAIR_STATE_ICON[repairState]}</span>
            {REPAIR_STATE_LABEL[repairState]}
          </span>
        </span>
        {/*
          MIDDLE ROW: the message — the loudest thing in the row, and the only thing at this size.
        */}
        <span className="line-clamp-2 min-w-0 text-[13px] leading-snug font-semibold text-fg">
          {finding.message}
        </span>
      </button>

      {/*
        BOTTOM ROW: location (muted, monospace) leads; actions follow, right-aligned by `ml-auto`
        on the first action element. Actions appear on hover, on keyboard focus, and on the selected
        row — never on all of them at once. Three buttons in every row of a long list is three
        buttons' worth of visual weight competing with the finding text itself, and rendering them
        permanently in a muted colour so they stop shouting just makes them look disabled instead
        (which is exactly how they read). Revealing them is the pattern Linear uses for row actions
        and VS Code for tree actions.
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
          'flex min-w-0 flex-wrap items-center gap-x-1 gap-y-1',
          'transition-opacity duration-(--fx-motion-duration-fast) ease-(--ease-entrance)',
          isSelected
            ? 'opacity-100'
            : 'opacity-70 group-hover/row:opacity-100 group-focus-within/row:opacity-100',
        )}
      >
        <span className="mr-auto min-w-0 shrink-0 truncate font-mono text-[11px] text-fg-secondary">
          {basename(finding.location.file)}:{finding.location.startLine}
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
                onClick={() => {
                  const now = Date.now();
                  if (now - lastAiClick.current < 500) return;
                  lastAiClick.current = now;
                  // Explain renders in the assistant pane's Explain tab, so take the user there —
                  // otherwise the answer streams in behind whichever tab they were already on.
                  if (action.profile === 'explain') setEditMode('explain');
                  void runAi(action.profile, finding.id);
                }}
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
        {finding.severity === 'error' && (
          <button
            type="button"
            title="See this issue in preview"
            onClick={() => {
              if (!previewIsOpen) {
                // Launch dev server first, then switch — the terminal session it starts keeps
                // running in the background regardless of which view ends up active (Terminal is
                // a permanent sibling, workbench.tsx), so switching to Preview immediately after
                // does not interrupt it.
                void usePreviewStore
                  .getState()
                  .launchAndPreview()
                  .then(() => {
                    setActiveView('preview');
                  });
              } else {
                setActiveView('preview');
              }
              // Flash/highlight effect — future enhancement
            }}
            className="shrink-0 rounded-md bg-accent/10 px-2 py-0.5 text-[11px] text-accent-text transition-colors hover:bg-accent/20"
          >
            Preview
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
});

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
