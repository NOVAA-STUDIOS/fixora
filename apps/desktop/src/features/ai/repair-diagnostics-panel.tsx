import type { AiProposal, StaleRangeCheck } from '@fixora/shared-types';
import { ChevronDownIcon, ChevronRightIcon, CopyIcon, cn } from '@fixora/ui';
import { useState } from 'react';

import { copyToClipboard } from '../../lib/clipboard.js';
import { useAiStore } from '../../stores/ai-store.js';

import { evaluateApplyGate, rootCauseOf } from './apply-diagnostics.js';

/**
 * Everything the Apply decision was made from, on demand.
 *
 * Collapsed by default — this is instrumentation, not product surface, and a repair preview that
 * opens with a wall of signatures would be worse for everyone who is not currently debugging. But
 * it is one click away and it hides nothing: gate, verdict, signature arithmetic, the exact IPC
 * request and response, and a one-line root cause.
 *
 * The reason it exists at all: three very different failures — the button was disabled, the IPC
 * never landed, main refused the write — were indistinguishable from the outside, and each has a
 * different fix. Naming which one happened is most of the diagnosis.
 */
export function RepairDiagnosticsPanel({
  proposal,
}: {
  proposal: Extract<AiProposal, { profile: 'repair' }>;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const attempt = useAiStore((s) => s.lastApplyAttempt);
  const gate = evaluateApplyGate(proposal);
  const report = proposal.verification;
  const diag = report.diagnostics;

  const dump = JSON.stringify(
    {
      finding: {
        severity: diag?.targetSeverity ?? 'unknown',
        signature: diag?.targetSignature ?? null,
      },
      verification: {
        verdict: report.verdict,
        targetResolved: report.targetResolved,
        newFindingCount: report.newFindingCount,
        syntaxOk: report.syntaxOk,
        ran: report.ran,
        note: report.note ?? null,
        diagnostics: diag ?? null,
      },
      applyGate: gate,
      lastAttempt:
        attempt === null
          ? null
          : {
              ...attempt,
              request: {
                ...attempt.request,
                code: `<${String(attempt.request.code.length)} chars>`,
                expectedOriginal: `<${String(attempt.request.expectedOriginal.length)} chars>`,
              },
              rootCause: rootCauseOf(attempt),
            },
    },
    null,
    2,
  );

  return (
    <div className="shrink-0 border-t border-border-subtle bg-inset">
      <button
        type="button"
        onClick={() => {
          setOpen((v) => !v);
        }}
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 px-3 py-1.5 text-left text-[11px] text-fg-muted transition-colors duration-(--fx-motion-duration-fast) hover:text-fg focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus-ring focus-visible:outline"
      >
        {open ? (
          <ChevronDownIcon className="size-3 shrink-0" />
        ) : (
          <ChevronRightIcon className="size-3 shrink-0" />
        )}
        Diagnostics
        <span
          className={cn(
            'ml-auto rounded px-1.5 py-px text-[10px] font-medium',
            gate.enabled
              ? 'bg-success-subtle text-success-text'
              : 'bg-danger-subtle text-danger-text',
          )}
        >
          Apply {gate.enabled ? 'enabled' : 'disabled'}
        </span>
      </button>

      {open && (
        <div className="flex max-h-64 flex-col gap-3 overflow-y-auto border-t border-border-subtle px-3 py-2.5">
          <Section title="Apply gate">
            <Row label="Enabled" value={String(gate.enabled)} tone={gate.enabled ? 'ok' : 'bad'} />
            <Row label="Reason" value={gate.reason} />
            <Row label="Explanation" value={gate.explanation} wrap />
            <Row
              label="Condition"
              value="enabled = verdict !== 'regression' && patch is non-empty"
              wrap
            />
            <Row label="Severity is an input" value="no" tone="ok" />
          </Section>

          <Section title="Finding">
            <Row label="Severity" value={diag?.targetSeverity ?? 'unknown'} />
            <Row label="Signature" value={diag?.targetSignature ?? 'unavailable'} mono wrap />
          </Section>

          <Section title="Verification">
            <Row
              label="Verdict"
              value={report.verdict}
              tone={report.verdict === 'regression' ? 'bad' : 'ok'}
            />
            <Row label="targetResolved" value={String(report.targetResolved)} />
            <Row
              label="newFindingCount"
              value={String(report.newFindingCount)}
              tone={report.newFindingCount > 0 ? 'bad' : 'ok'}
            />
            <Row
              label="syntaxOk"
              value={String(report.syntaxOk)}
              tone={report.syntaxOk ? 'ok' : 'bad'}
            />
            <Row label="Analyzers ran" value={report.ran.join(', ') || 'none'} wrap />
            {report.note !== undefined && <Row label="Note" value={report.note} wrap />}
          </Section>

          {diag !== undefined && (
            <Section title="Signature comparison">
              {/* The arithmetic behind a `regression`. If newSignatures contains rules that simply
                  did not run during the workspace analysis, the regression is an artefact of the
                  overlay's toolset, not of the patch — and these two source lists show that. */}
              <Row
                label="Baseline sources"
                value={diag.originalSources.join(', ') || 'none'}
                wrap
              />
              <Row
                label="Overlay sources"
                value={diag.patchedSources.join(', ') || 'none'}
                wrap
                {...(sameSet(diag.originalSources, diag.patchedSources)
                  ? {}
                  : { tone: 'bad' as const })}
              />
              <List
                label={`New signatures (${String(diag.newSignatures.length)})`}
                items={diag.newSignatures}
                tone="bad"
              />
              <List
                label={`Baseline (${String(diag.originalSignatures.length)})`}
                items={diag.originalSignatures}
              />
              <List
                label={`Patched (${String(diag.patchedSignatures.length)})`}
                items={diag.patchedSignatures}
              />
            </Section>
          )}

          <Section title="Last apply attempt">
            {attempt === null ? (
              <p className="text-[11px] text-fg-muted">Apply has not been pressed yet.</p>
            ) : (
              <>
                <Row
                  label="Root cause"
                  value={rootCauseOf(attempt)}
                  wrap
                  tone={attempt.response?.applied === true ? 'ok' : 'bad'}
                />
                <Row label="Severity at attempt" value={attempt.findingSeverity} />
                <Row label="Duration" value={`${String(attempt.durationMs ?? 0)}ms`} />
                <Row
                  label="IPC request"
                  value={`${attempt.request.file}:${String(attempt.request.startLine)}-${String(attempt.request.endLine)} · code ${String(attempt.request.code.length)} chars · expected ${String(attempt.request.expectedOriginal.length)} chars`}
                  mono
                  wrap
                />
                {attempt.transportError !== null && (
                  <Row label="Transport error" value={attempt.transportError} tone="bad" wrap />
                )}
                {attempt.response !== null && (
                  <>
                    <Row
                      label="IPC response"
                      value={
                        attempt.response.applied
                          ? 'applied: true'
                          : `applied: false · ${attempt.response.reason}`
                      }
                      tone={attempt.response.applied ? 'ok' : 'bad'}
                      mono
                    />
                    {!attempt.response.applied && (
                      <Row label="Message" value={attempt.response.message} wrap />
                    )}
                    {attempt.response.staleRangeCheck !== null && (
                      <StaleRange check={attempt.response.staleRangeCheck} />
                    )}
                  </>
                )}
              </>
            )}
          </Section>

          <button
            type="button"
            onClick={() => void copyToClipboard(dump, { label: 'Diagnostics copied' })}
            className="flex items-center justify-center gap-1.5 rounded-md border border-border-strong bg-raised px-2 py-1 text-[11px] font-medium text-fg-secondary transition-colors duration-(--fx-motion-duration-fast) hover:bg-hover hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus-ring focus-visible:outline"
          >
            <CopyIcon className="size-3" />
            Copy full diagnostics as JSON
          </button>
        </div>
      )}
    </div>
  );
}

function StaleRange({ check }: { check: StaleRangeCheck }): React.JSX.Element {
  return (
    <>
      <Row
        label="Stale-range check"
        value={check.passed ? 'passed' : 'FAILED'}
        tone={check.passed ? 'ok' : 'bad'}
      />
      <Row
        label="Range"
        value={`lines ${String(check.startLine)}-${String(check.endLine)} of ${String(check.fileLineCount)}`}
        mono
      />
      <Row
        label="Expected"
        value={`${String(check.expectedLength)} chars · sha1 ${check.expectedHash}`}
        mono
      />
      <Row
        label="Actual"
        value={`${String(check.actualLength)} chars · sha1 ${check.actualHash}`}
        mono
        tone={check.expectedHash === check.actualHash ? 'ok' : 'bad'}
      />
      {check.firstDifferingLine !== null && (
        <>
          <Row
            label="First difference"
            value={`line ${String(check.firstDifferingLine)} of the range`}
            tone="bad"
          />
          {/* The user's own code, on the user's own screen — bounded to three lines around the
              difference, which is what identifies the edit without reproducing the file. */}
          <pre className="overflow-x-auto rounded bg-canvas p-2 font-mono text-[10px] text-fg-muted">
            {`expected:
${check.expectedExcerpt}

actual:
${check.actualExcerpt}`}
          </pre>
        </>
      )}
    </>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <section className="flex flex-col gap-1">
      <h4 className="text-[10px] font-semibold uppercase tracking-wider text-fg-muted">{title}</h4>
      <div className="flex flex-col gap-0.5">{children}</div>
    </section>
  );
}

function Row({
  label,
  value,
  mono = false,
  wrap = false,
  tone,
}: {
  label: string;
  value: string;
  mono?: boolean;
  wrap?: boolean;
  tone?: 'ok' | 'bad';
}): React.JSX.Element {
  return (
    <div className="flex gap-2 text-[11px]">
      <span className="w-32 shrink-0 text-fg-muted">{label}</span>
      <span
        className={cn(
          'min-w-0 flex-1',
          mono && 'font-mono',
          wrap ? '[overflow-wrap:anywhere]' : 'truncate',
          tone === 'ok'
            ? 'text-success-text'
            : tone === 'bad'
              ? 'text-danger-text'
              : 'text-fg-secondary',
        )}
      >
        {value}
      </span>
    </div>
  );
}

function List({
  label,
  items,
  tone,
}: {
  label: string;
  items: string[];
  tone?: 'bad';
}): React.JSX.Element {
  return (
    <div className="flex gap-2 text-[11px]">
      <span className="w-32 shrink-0 text-fg-muted">{label}</span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        {items.length === 0 ? (
          <span className="text-fg-muted">none</span>
        ) : (
          items.map((s) => (
            <span
              key={s}
              className={cn(
                'font-mono [overflow-wrap:anywhere]',
                tone === 'bad' ? 'text-danger-text' : 'text-fg-secondary',
              )}
            >
              {s}
            </span>
          ))
        )}
      </div>
    </div>
  );
}

function sameSet(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((x) => b.includes(x));
}
