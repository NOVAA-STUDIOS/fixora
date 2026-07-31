import type { AiProposal, Finding, RepairSummaryEntry, Severity } from '@fixora/shared-types';
import { AlertIcon, Button, cn } from '@fixora/ui';
import { useState } from 'react';

import { copyToClipboard } from '../../lib/clipboard.js';
import { basename } from '../../lib/path.js';
import { useAiStore } from '../../stores/ai-store.js';
import { DiffEditor } from '../editor/diff-editor.js';
import { useWorkspaceStore } from '../workspace/workspace-store.js';

import { evaluateApplyGate, recoveryHintFor } from './apply-diagnostics.js';
import { RepairDiagnosticsPanel } from './repair-diagnostics-panel.js';
import { IMPACT_DOT, IMPACT_LABEL, IMPACT_TEXT, repairImpact } from './repair-impact.js';
import { repairModeInfo } from './repair-mode.js';
import { validationBadges, type ValidationBadge } from './validation-badges.js';

/**
 * The repair result surface.
 *
 * Rebuilt against a specific set of layout constraints, each of which was a real defect before:
 *
 *  - **One scroll region, never two.** The old layout put a `shrink-0` diagnostics panel of unbounded
 *    height inside an `overflow-hidden` column with no scroll container, so an expanded panel — or a
 *    failed Apply's remedy banner — overflowed and was silently CLIPPED with no way to reach it.
 *  - **The first screen answers the question.** Rule id, severity, confidence and the four validation
 *    badges sit above the scroll region, so what the repair is and whether it is trustworthy never
 *    require scrolling to discover.
 *  - **The diff is opt-in.** It was the tallest thing on screen and always mounted, which is what
 *    forced everything else into a scroll. It collapses now, and "Preview Diff" in the action bar
 *    toggles it — the same control the spec asks for.
 *  - **The action bar is pinned.** Apply is reachable at every width and every scroll position.
 *  - **A rejection is a compact alert**, not a banner that displaces the panel.
 *
 * Everything here is width-responsive down to 300px: every row wraps, nothing has a fixed width, and
 * the metadata chips reflow rather than truncate the values that carry meaning.
 */

const SEVERITY_STYLE: Record<Severity, string> = {
  error: 'bg-danger-subtle text-danger-text',
  warning: 'bg-warn-subtle text-warn-text',
  info: 'bg-inset text-fg-muted',
};

const BADGE_STYLE: Record<ValidationBadge['status'], string> = {
  pass: 'bg-success-subtle text-success-text',
  fail: 'bg-danger-subtle text-danger-text',
  // Deliberately neutral, never green: "not run" is an absence of evidence, not a pass.
  'not-run': 'bg-inset text-fg-muted',
};

const BADGE_MARK: Record<ValidationBadge['status'], string> = {
  pass: '✓',
  fail: '✕',
  'not-run': '–',
};

/** How much rationale to show before folding it behind "Show more". */
const RATIONALE_CLAMP = 180;

/** A labelled fact. Reads as a value, not prose — which is what a rule id or a percentage is. */
function Chip({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <span className="flex min-w-0 items-center gap-1 rounded-md bg-inset px-1.5 py-0.5 text-[10px] ring-1 ring-border-subtle ring-inset">
      <span className="shrink-0 uppercase tracking-wide text-fg-muted">{label}</span>
      <span className="min-w-0 truncate font-medium text-fg-secondary">{value}</span>
    </span>
  );
}

/**
 * The patch card — the panel's primary object.
 *
 * Four facts, separated and ranked: what mode produced this patch, what it will replace, how much
 * code that is, and which validations actually ran. They were previously a flat row of badges plus a
 * yellow banner, which read as status furniture rather than as a description of the change about to
 * be made to someone's file.
 *
 * Mode is carried by a left border and a label rather than a filled background: a whole-file rewrite
 * needs to look different from a one-line fix, but tinting a third of the panel yellow to say so is
 * an alarm, not a hierarchy.
 */
function PatchCard({
  proposal,
  badges,
}: {
  proposal: Extract<AiProposal, { profile: 'repair' }>;
  badges: ValidationBadge[];
}): React.JSX.Element {
  const mode = repairModeInfo(proposal.mode);
  const lines = proposal.target.endLine - proposal.target.startLine + 1;
  const impact = repairImpact(proposal.mode, lines);

  return (
    <div
      className={cn(
        'flex flex-col overflow-hidden rounded-md border border-border-subtle bg-inset',
        // The mode's signature: a left rule, weighted by blast radius.
        'border-l-2',
        mode.mode === 'ai-file'
          ? 'border-l-danger'
          : mode.mode === 'related-scope'
            ? 'border-l-accent'
            : 'border-l-border-strong',
      )}
    >
      {/* Row 1 — mode, and the impact verdict. The two things read first. */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-2.5 pt-2">
        <span className="min-w-0 truncate text-xs font-semibold text-fg">{mode.label}</span>
        {mode.advanced && (
          <span className="shrink-0 rounded bg-danger-subtle px-1 py-px text-[9px] font-semibold uppercase tracking-wide text-danger-text">
            Advanced
          </span>
        )}
        <span
          className="ml-auto flex shrink-0 items-center gap-1"
          title={`Estimated impact: ${IMPACT_LABEL[impact.level]} — ${impact.summary}`}
        >
          <span
            aria-hidden="true"
            className={cn('size-2 rounded-full', IMPACT_DOT[impact.level])}
          />
          <span className={cn('text-[10px] font-medium', IMPACT_TEXT[impact.level])}>
            {IMPACT_LABEL[impact.level]} impact
          </span>
        </span>
      </div>

      {/* Row 2 — scope and size. Concise: a label, a value, a line range. */}
      <dl className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-2.5 pb-2 pt-1 text-[11px]">
        <div className="flex min-w-0 items-baseline gap-1.5">
          <dt className="shrink-0 text-[9px] uppercase tracking-wide text-fg-muted">Scope</dt>
          <dd className="min-w-0 truncate text-fg-secondary">{mode.scopeLabel}</dd>
        </div>
        <div className="flex shrink-0 items-baseline gap-1.5">
          <dt className="text-[9px] uppercase tracking-wide text-fg-muted">Lines</dt>
          <dd className="font-mono tabular-nums text-fg-secondary">
            {proposal.target.startLine}–{proposal.target.endLine}
          </dd>
        </div>
        <div className="flex shrink-0 items-baseline gap-1.5">
          <dt className="text-[9px] uppercase tracking-wide text-fg-muted">Impact</dt>
          <dd className="text-fg-secondary">{impact.summary}</dd>
        </div>
      </dl>

      {/* Row 3 — the validations, on their own surface so they read as a result, not a property. */}
      <div className="flex flex-wrap items-center gap-1 border-t border-border-subtle bg-raised px-2.5 py-1.5">
        <span className="mr-0.5 shrink-0 text-[9px] uppercase tracking-wide text-fg-muted">
          Validation
        </span>
        <ValidationRow badges={badges} />
      </div>
    </div>
  );
}

type RootCause = NonNullable<Extract<AiProposal, { profile: 'repair' }>['rootCause']>;

const ROOT_CAUSE_BASIS_LABEL: Record<RootCause['basis'], string> = {
  identifier: 'Same missing name, found elsewhere in this file',
  scope: 'Grouped with nearby findings in the same code block',
  singleton: 'No other findings grouped with it',
};

/**
 * The Root Cause View — Advanced Repair only. Answers the question a coordinated, possibly-retargeted
 * patch raises immediately: "why is this touching a different line than the one I selected?"
 *
 * Rendered only when `proposal.rootCause` is present (additive on the wire; every other mode has no
 * such field). `estimatedDiagnosticsRemoved` is stated as an estimate here too, on purpose — the
 * validation row above it is what actually confirms anything, and this card must never look like a
 * second source of truth competing with it.
 */
function RootCauseCard({ rootCause }: { rootCause: RootCause }): React.JSX.Element {
  return (
    <div className="flex flex-col gap-1.5 rounded-md border border-accent-border bg-accent-subtle px-2.5 py-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="shrink-0 text-[9px] font-semibold uppercase tracking-wide text-accent-text">
          Root cause
        </span>
        {rootCause.differsFromSelection && (
          <span
            className="shrink-0 rounded bg-inset px-1 py-px text-[9px] font-medium text-fg-muted"
            title="Advanced Repair traced this problem to a different location than the one you selected."
          >
            different location
          </span>
        )}
      </div>
      <p className="text-[11px] leading-snug text-fg-secondary [overflow-wrap:anywhere]">
        <code className="font-mono text-[10px] text-fg">{rootCause.ruleId}</code>
        {' at line '}
        <span className="font-mono tabular-nums">{rootCause.line}</span>
        {': '}
        {rootCause.message}
      </p>
      <p className="text-[10px] text-fg-muted">
        {ROOT_CAUSE_BASIS_LABEL[rootCause.basis]}
      </p>
      {rootCause.affected.length > 0 && (
        <p className="text-[10px] text-fg-muted [overflow-wrap:anywhere]">
          Estimated {rootCause.affected.length}{' '}
          {rootCause.affected.length === 1 ? 'diagnostic' : 'diagnostics'} may clear as a side
          effect — confirmed by validation below, not by this estimate.
        </p>
      )}
    </div>
  );
}

/**
 * The four validation badges. `title` carries the full sentence, so a badge is never a bare mark the
 * user has to interpret — and `not-run` is styled neutrally so it cannot be mistaken for a pass.
 */
function ValidationRow({ badges }: { badges: ValidationBadge[] }): React.JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-1" role="list" aria-label="Validation">
      {badges.map((badge) => (
        <span
          key={badge.name}
          role="listitem"
          title={badge.detail}
          className={cn(
            'flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium',
            BADGE_STYLE[badge.status],
          )}
        >
          <span aria-hidden="true">{BADGE_MARK[badge.status]}</span>
          {badge.name}
        </span>
      ))}
    </div>
  );
}

/** A collapsible section with a real button header — keyboard reachable, state announced. */
function Section({
  title,
  count,
  defaultOpen = false,
  children,
}: {
  title: string;
  count?: number;
  defaultOpen?: boolean;
  children: React.ReactNode;
}): React.JSX.Element {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-border-subtle">
      <button
        type="button"
        onClick={() => {
          setOpen((o) => !o);
        }}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-fg-secondary hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset--2 focus-visible:outline-focus-ring focus-visible:outline"
      >
        <span aria-hidden="true" className="text-fg-muted">
          {open ? '▾' : '▸'}
        </span>
        <span className="min-w-0 truncate">{title}</span>
        {count !== undefined && count > 0 && (
          <span className="ml-auto shrink-0 rounded-full bg-inset px-1.5 text-[10px] tabular-nums text-fg-muted">
            {count}
          </span>
        )}
      </button>
      {open && <div className="px-3 pb-2.5">{children}</div>}
    </div>
  );
}

function SummaryList({
  entries,
  tone,
}: {
  entries: readonly RepairSummaryEntry[];
  tone: 'fixed' | 'skipped';
}): React.JSX.Element {
  return (
    <ul className="flex flex-col gap-1.5">
      {entries.map((entry, i) => (
        <li key={`${entry.ruleId}:${String(entry.line)}:${String(i)}`} className="flex gap-2">
          <span
            aria-hidden="true"
            className={cn(
              'mt-px shrink-0',
              tone === 'fixed' ? 'text-success-text' : 'text-fg-muted',
            )}
          >
            {tone === 'fixed' ? '✓' : '–'}
          </span>
          <div className="flex min-w-0 flex-col">
            <span className="text-[11px] leading-snug text-fg-secondary [overflow-wrap:anywhere]">
              <span className="font-mono text-fg-muted">
                {entry.ruleId}:{entry.line}
              </span>{' '}
              {entry.message}
            </span>
            {/* The reason is the point of the skipped list — a patch that leaves problems alone
                without saying why is indistinguishable from one that missed them. */}
            {entry.reason !== undefined && (
              <span className="text-[10px] leading-snug text-fg-muted [overflow-wrap:anywhere]">
                {entry.reason}
              </span>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

export function RepairResult({
  proposal,
  finding,
}: {
  proposal: Extract<AiProposal, { profile: 'repair' }>;
  /** The finding this repair targets, for the rule id and severity. Null if it is no longer loaded. */
  finding: Finding | null;
}): React.JSX.Element {
  const applyRepair = useAiStore((s) => s.applyRepair);
  const dismiss = useAiStore((s) => s.dismiss);
  const revealAt = useWorkspaceStore((s) => s.revealAt);
  const [diffView, setDiffView] = useState<'unified' | 'split'>('split');
  const [showFullRationale, setShowFullRationale] = useState(false);

  const gate = evaluateApplyGate(proposal);
  const badges = validationBadges(proposal);
  const summary = proposal.repairSummary;
  // Keyed off the GATE, not the verdict: the alert exists to explain a DISABLED Apply, and
  // those are now exactly the same condition.
  const rejected = !gate.enabled;

  const rationale = proposal.rationale;
  const isLong = rationale.length > RATIONALE_CLAMP;
  const shown =
    isLong && !showFullRationale ? `${rationale.slice(0, RATIONALE_CLAMP)}…` : rationale;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/*
        ── First screen ────────────────────────────────────────────────────────────────────────────
        Rule, severity, confidence and validation, above the scroll region. Whether this repair is
        trustworthy is answerable without scrolling, at any width — every row here wraps.
      */}
      <div className="flex shrink-0 flex-col gap-2 border-b border-border-subtle px-3 py-2.5">
        <div className="flex flex-wrap items-center gap-1.5">
          {finding !== null && (
            <span
              className={cn(
                'shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium capitalize',
                SEVERITY_STYLE[finding.severity],
              )}
            >
              {finding.severity}
            </span>
          )}
          {finding !== null && <Chip label="Rule" value={finding.ruleId} />}
          <Chip label="Confidence" value={`${String(Math.round(proposal.confidence * 100))}%`} />
          <Chip
            label="File"
            value={`${basename(proposal.target.file)}:${String(proposal.target.startLine)}`}
          />
        </div>
        <PatchCard proposal={proposal} badges={badges} />
        {proposal.rootCause !== undefined && <RootCauseCard rootCause={proposal.rootCause} />}
      </div>

      {/*
        A rejection is a COMPACT alert, not a banner that displaces the panel. It says what happened
        and why in two lines and takes no more room than that.
      */}
      {rejected && (
        <div
          role="alert"
          className="flex shrink-0 items-start gap-2 border-b border-border-subtle bg-danger-subtle px-3 py-2"
        >
          <AlertIcon className="mt-px size-3.5 shrink-0 text-danger-text" />
          <div className="flex min-w-0 flex-col gap-0.5">
            <p className="text-[11px] leading-snug text-danger-text [overflow-wrap:anywhere]">
              <span className="font-semibold">Apply is disabled — {gate.reason}.</span>{' '}
              {gate.explanation}
            </p>
            {/* How to proceed. A blocked control that does not say what to do next is a dead end. */}
            <p className="text-[10px] leading-snug text-fg-muted [overflow-wrap:anywhere]">
              {recoveryHintFor(gate.reason)}
            </p>
          </div>
        </div>
      )}

      {/*
        ── The diff: the primary review surface ────────────────────────────────────────────────────
        It is `flex-1`, so it takes every pixel the chrome does not need, and it is ALWAYS mounted —
        including for a rejected patch, because "what did it try to do?" is exactly the question a
        rejection raises. Making it opt-in was a regression: it solved a layout problem by hiding the
        one thing the panel exists to show.

        Monaco carries the rest by itself: red/green gutters, changed-line highlighting, unchanged
        context, syntax highlighting, and virtualised rendering for a large patch.
      */}
      <div className="flex min-h-0 flex-1 flex-col border-b border-border-subtle">
        <div className="flex shrink-0 items-center gap-2 border-b border-border-subtle bg-inset px-3 py-1">
          <span className="text-[9px] uppercase tracking-wide text-fg-muted">Changes</span>
          <span className="font-mono text-[10px] text-fg-secondary">
            {basename(proposal.target.file)}:{proposal.target.startLine}–{proposal.target.endLine}
          </span>
          {/*
            The view toggle. Offered for the whole-file mode, where a patch is long enough that two
            columns genuinely help; below that the pane is too narrow for two readable columns and the
            responsive default is the better answer.
          */}
          {proposal.mode === 'ai-file' && (
            <div
              className="ml-auto flex shrink-0 items-center gap-0.5"
              role="group"
              aria-label="Diff view"
            >
              {(
                [
                  ['unified', 'Unified'],
                  ['split', 'Side-by-side'],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={diffView === value}
                  onClick={() => {
                    setDiffView(value);
                  }}
                  className={cn(
                    'rounded px-1.5 py-0.5 text-[10px] transition-colors',
                    diffView === value
                      ? 'bg-raised text-fg ring-1 ring-border-strong ring-inset'
                      : 'text-fg-muted hover:text-fg',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="min-h-0 flex-1">
          <DiffEditor
            original={proposal.originalCode}
            modified={proposal.repairedCode}
            language={monacoLanguageFor(proposal.target.file)}
            // Real file lines, not the slice's 1..n.
            startLine={proposal.target.startLine}
            sideBySide={proposal.mode === 'ai-file' ? diffView === 'split' : undefined}
            onLineClick={(fileLine) => {
              revealAt({
                file: proposal.target.file,
                startLine: fileLine,
                startCol: 1,
                endLine: fileLine,
                endCol: 1,
              });
            }}
          />
        </div>
      </div>

      {/*
        ── Secondary: rationale, summary, diagnostics ──────────────────────────────────────────────
        Below the diff and height-capped with its own scroll, so the summary can never displace the
        code it describes, and an expanded diagnostics panel can never overflow the container the way
        the original `shrink-0` one did.
      */}
      <div className="max-h-[38%] shrink-0 overflow-y-auto border-b border-border-subtle">
        <div className="border-b border-border-subtle px-3 py-2.5">
          <p className="text-xs leading-relaxed text-fg-secondary [overflow-wrap:anywhere]">
            {shown}
          </p>
          {isLong && (
            <button
              type="button"
              onClick={() => {
                setShowFullRationale((v) => !v);
              }}
              aria-expanded={showFullRationale}
              className="mt-1 rounded text-[11px] text-accent-text hover:underline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus-ring focus-visible:outline"
            >
              {showFullRationale ? 'Show less' : 'Show more'}
            </button>
          )}
        </div>

        {summary !== undefined && (
          <Section
            title="Repair summary"
            count={summary.fixed.length + summary.related.length}
            // Visible, not hidden: it sits BELOW the diff in a height-capped region, so it informs
            // the review without ever displacing the code it describes.
            defaultOpen
          >
            <div className="flex flex-col gap-2.5">
              {summary.fixed.length > 0 && (
                <div className="flex flex-col gap-1">
                  <p className="text-[10px] uppercase tracking-wide text-fg-muted">Fixed</p>
                  <SummaryList entries={summary.fixed} tone="fixed" />
                </div>
              )}
              {summary.related.length > 0 && (
                <div className="flex flex-col gap-1">
                  <p className="text-[10px] uppercase tracking-wide text-fg-muted">
                    Related issues repaired
                  </p>
                  <SummaryList entries={summary.related} tone="fixed" />
                </div>
              )}
              {summary.skipped.length > 0 && (
                <div className="flex flex-col gap-1">
                  <p className="text-[10px] uppercase tracking-wide text-fg-muted">
                    Skipped ({summary.skipped.length})
                  </p>
                  <SummaryList entries={summary.skipped} tone="skipped" />
                </div>
              )}
            </div>
          </Section>
        )}

        <RepairDiagnosticsPanel proposal={proposal} />
      </div>

      {/*
        ── Sticky action bar ───────────────────────────────────────────────────────────────────────
        Outside the scroll region, so Apply is reachable at every scroll position and every width.
        Wraps rather than overflowing at 300px.
      */}
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-t border-border-subtle bg-inset px-3 py-2.5">
        <Button variant="ghost" size="sm" className="shrink-0" onClick={dismiss}>
          Dismiss
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="shrink-0"
          disabled={proposal.repairedCode.length === 0}
          // A patch, not just the replacement text: the before/after with its location is what
          // someone can paste into a review. The old "Copy" copied only the new code and was
          // labelled as though it copied a patch.
          onClick={() => void copyToClipboard(buildPatchText(proposal), { label: 'Patch copied' })}
        >
          Copy Patch
        </Button>
        <Button
          variant="primary"
          size="sm"
          className="ml-auto shrink-0"
          disabled={!gate.enabled}
          title={gate.enabled ? gate.explanation : `Apply is disabled: ${gate.explanation}`}
          onClick={() => void applyRepair()}
        >
          Apply
        </Button>
      </div>
    </div>
  );
}

const MONACO_LANG: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  py: 'python',
  go: 'go',
  json: 'json',
  css: 'css',
  html: 'html',
  htm: 'html',
};

function monacoLanguageFor(file: string): string {
  return MONACO_LANG[file.split('.').pop()?.toLowerCase() ?? ''] ?? 'plaintext';
}

/**
 * A copyable patch: where it applies, and the before/after. Not a unified diff — generating one
 * correctly needs hunk arithmetic this does not do, and a mislabelled "diff" that no tool can apply
 * would be worse than an honest before/after block.
 */
export function buildPatchText(proposal: Extract<AiProposal, { profile: 'repair' }>): string {
  const { file, startLine, endLine } = proposal.target;
  return [
    `# ${file}:${String(startLine)}-${String(endLine)}`,
    '',
    '--- before',
    proposal.originalCode,
    '',
    '+++ after',
    proposal.repairedCode,
    '',
  ].join('\n');
}
