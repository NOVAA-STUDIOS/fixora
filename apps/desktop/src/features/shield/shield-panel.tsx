import type { CodeShieldReport, PrReadiness, ShieldIssue } from '@fixora/shared-types';
import { AlertIcon, CheckIcon, CloseIcon, cn } from '@fixora/ui';

import { basename } from '../../lib/path.js';
import { useAiStore } from '../../stores/ai-store.js';
import { useWorkspaceStore } from '../workspace/workspace-store.js';

import { useShieldStore } from './shield-store.js';

/** Score bands. The same thresholds the service uses for `prReadiness`, so the colour and the
 *  banner can never tell the user two different stories about one number. */
export function scoreTone(score: number): 'good' | 'warn' | 'bad' {
  if (score >= 85) return 'good';
  if (score >= 60) return 'warn';
  return 'bad';
}

const TONE_TEXT = {
  good: 'text-success-text',
  warn: 'text-warn-text',
  bad: 'text-danger-text',
} as const;

const TONE_RING = {
  good: 'border-success-text',
  warn: 'border-warn-text',
  bad: 'border-danger-text',
} as const;

const READINESS: Record<PrReadiness, { label: string; className: string }> = {
  ready: { label: '✅ Ready to merge!', className: 'bg-success-subtle text-success-text' },
  'needs-work': { label: '⚠️ Needs work before PR', className: 'bg-warn-subtle text-warn-text' },
  'not-ready': { label: '❌ Not ready for PR', className: 'bg-danger-subtle text-danger-text' },
};

/**
 * Code Shield — the per-file report, as a slide-in panel.
 *
 * Every number rendered here came from `shield-service.ts`, which derives it from real analyzer
 * output. When the report carries an `error` this shows that error and NO score: a plausible number
 * next to a failed run is the one outcome this whole feature cannot afford.
 */
export function ShieldPanel(): React.JSX.Element | null {
  const open = useShieldStore((s) => s.panelOpen);
  const setPanelOpen = useShieldStore((s) => s.setPanelOpen);
  const report = useShieldStore((s) => s.currentReport);
  const isAnalyzing = useShieldStore((s) => s.isAnalyzing);
  const pendingFile = useShieldStore((s) => s.pendingFile);

  if (!open) return null;

  // While a new run is in flight, `report` (if any) is still the PREVIOUS file's — named here so
  // re-analyzing on switch never reads as "this is file B's score" while it is really file A's.
  const shownFile = isAnalyzing ? (pendingFile ?? report?.file ?? null) : (report?.file ?? null);

  return (
    <aside
      aria-label="Code Shield"
      className="absolute right-0 top-0 z-(--fx-z-dialog) flex h-full w-[380px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden border-l border-border-subtle bg-raised shadow-2xl"
    >
      <header className="flex h-10 shrink-0 items-center justify-between gap-2 border-b border-border-subtle px-3">
        <h2 className="flex min-w-0 items-center gap-2 text-sm font-semibold text-fg">
          <span className="shrink-0">🛡️ Code Shield</span>
          {shownFile !== null && (
            <span className="min-w-0 truncate text-xs font-normal text-fg-muted">
              {basename(shownFile)}
            </span>
          )}
        </h2>
        <button
          type="button"
          aria-label="Close Code Shield"
          onClick={() => {
            setPanelOpen(false);
          }}
          className="rounded p-1 text-fg-muted transition-colors hover:bg-hover hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus-ring focus-visible:outline"
        >
          <CloseIcon className="size-3.5" />
        </button>
      </header>

      {isAnalyzing && report !== null && report.error === null && (
        <p
          role="status"
          className="shrink-0 border-b border-border-subtle bg-inset px-3 py-1.5 text-center text-[11px] text-fg-muted"
        >
          Analyzing current file…
        </p>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {isAnalyzing && report === null ? (
          <p className="py-10 text-center text-sm text-fg-muted">Analyzing your code…</p>
        ) : report === null ? (
          <p className="py-10 text-center text-sm text-fg-muted">
            Open a file to see its Code Shield report.
          </p>
        ) : report.error !== null ? (
          <div className="flex flex-col items-center gap-2 py-10 text-center">
            <AlertIcon className="size-6 text-danger-text" />
            <p className="text-sm font-medium text-fg">Analysis didn&rsquo;t complete</p>
            <p className="max-w-xs text-xs text-fg-muted">{report.error}</p>
          </div>
        ) : (
          <ShieldReportView report={report} isAnalyzing={isAnalyzing} />
        )}
      </div>
    </aside>
  );
}

function ShieldReportView({
  report,
  isAnalyzing,
}: {
  report: CodeShieldReport;
  isAnalyzing: boolean;
}): React.JSX.Element {
  // `error === null` guarantees a real, measured score (`shield-service.ts`) — but the schema still
  // types the two independently, so this is checked rather than assumed. A missing score here must
  // show as "not measured", never as a silent 0.
  if (report.score === null) {
    return (
      <div className="flex flex-col items-center gap-2 py-10 text-center">
        <AlertIcon className="size-6 text-danger-text" />
        <p className="text-sm font-medium text-fg">No score available</p>
      </div>
    );
  }

  const tone = scoreTone(report.score);
  const clean = report.critical.length === 0 && report.warnings.length === 0;
  const readiness = READINESS[report.prReadiness];

  return (
    <div className={cn('flex flex-col gap-5', isAnalyzing && 'opacity-60')}>
      <div className="flex flex-col items-center gap-3">
        <div
          className={cn(
            'flex size-24 items-center justify-center rounded-full border-4',
            TONE_RING[tone],
          )}
        >
          <span className={cn('text-3xl font-semibold tabular-nums', TONE_TEXT[tone])}>
            {report.score}
          </span>
        </div>
        <span
          className={cn('rounded-full px-3 py-1 text-xs font-medium', readiness.className)}
          role="status"
        >
          {readiness.label}
        </span>
      </div>

      {clean && (
        <p className="rounded-lg bg-inset px-3 py-4 text-center text-sm text-fg">
          🛡️ Your code looks great! Ready to ship.
        </p>
      )}

      {report.critical.length > 0 && (
        <IssueSection title="Critical Issues" issues={report.critical} />
      )}
      {report.warnings.length > 0 && <IssueSection title="Warnings" issues={report.warnings} />}

      {report.passed.length > 0 && (
        <section className="flex flex-col gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-muted">Checks</h3>
          <ul className="flex flex-col gap-1.5">
            {report.passed.map((check) => (
              <li key={check.name} className="flex items-start gap-2 text-xs text-fg-muted">
                {check.passed ? (
                  <CheckIcon className="mt-0.5 size-3 shrink-0 text-success-text" />
                ) : (
                  <span aria-hidden="true" className="mt-0.5 shrink-0 text-warn-text">
                    ✗
                  </span>
                )}
                <span>
                  <span className="font-medium text-fg">{check.name}</span> — {check.message}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function IssueSection({
  title,
  issues,
}: {
  title: string;
  issues: readonly ShieldIssue[];
}): React.JSX.Element {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-muted">
        {title} ({issues.length})
      </h3>
      <ul className="flex flex-col gap-2">
        {issues.map((issue) => (
          <IssueRow key={issue.id} issue={issue} />
        ))}
      </ul>
    </section>
  );
}

function IssueRow({ issue }: { issue: ShieldIssue }): React.JSX.Element {
  const revealAt = useWorkspaceStore((s) => s.revealAt);
  const runAi = useAiStore((s) => s.run);
  const aiConfigured = useAiStore((s) => s.config?.configured ?? false);

  return (
    <li className="flex flex-col gap-2 rounded-lg border border-border-subtle bg-inset px-3 py-2.5">
      <div className="flex items-start gap-2">
        <span aria-hidden="true" className="shrink-0 text-sm">
          {issue.severity === 'critical' ? '🔴' : '🟡'}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-fg">{issue.message}</p>
          <button
            type="button"
            onClick={() => {
              revealAt({
                file: issue.file,
                startLine: issue.line,
                startCol: 1,
                endLine: issue.line,
                endCol: 1,
                severity: issue.severity === 'critical' ? 'error' : 'warning',
              });
            }}
            className="mt-0.5 text-[11px] text-accent-text hover:underline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus-ring focus-visible:outline"
          >
            {issue.category} · line {issue.line}
          </button>
        </div>
      </div>

      <p className="rounded-md border-l-2 border-accent-border bg-accent-subtle px-2.5 py-1.5 text-[11px] italic leading-relaxed text-fg-secondary">
        {issue.seniorAdvice}
      </p>

      {issue.fixAvailable && (
        <button
          type="button"
          disabled={!aiConfigured}
          title={aiConfigured ? undefined : 'Set up an AI provider to repair from here'}
          onClick={() => {
            void runAi('repair', issue.id);
          }}
          className="self-start rounded-md border border-border-strong bg-raised px-2 py-0.5 text-[11px] font-medium text-fg-secondary transition-colors hover:border-accent-border hover:bg-hover hover:text-fg disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus-ring focus-visible:outline"
        >
          Auto-Fix
        </button>
      )}
    </li>
  );
}
