import type { AiProposal, StaleRangeCheck } from '@fixora/shared-types';
import {
  AlertIcon,
  Button,
  ChevronDownIcon,
  ChevronRightIcon,
  CopyIcon,
  ExternalIcon,
  RefreshIcon,
  cn,
} from '@fixora/ui';
import { useState } from 'react';

import { invoke } from '../../lib/bridge.js';
import { copyToClipboard } from '../../lib/clipboard.js';
import { useAiStore } from '../../stores/ai-store.js';

import {
  evaluateApplyGate,
  remedyFor,
  rootCauseOf,
  type ApplyAttempt,
  type ApplyGate,
} from './apply-diagnostics.js';

/**
 * The repair failure surface.
 *
 * The previous version showed everything at once, in the vocabulary of the code that produced it —
 * `stale-range`, signature sets, sha1s. That is the right information and the wrong audience for
 * the first thing you see. Someone whose Apply just failed needs two sentences and a button; the
 * signature arithmetic matters to exactly one person, on exactly the day they are debugging it.
 *
 * So it is tiered, the way a browser's error console is: a plain-language reason and a remedy at
 * the top, everything else behind one disclosure. Nothing was removed — the same JSON is a click
 * away, and now it travels with the build metadata a bug report is useless without.
 */
export function RepairDiagnosticsPanel({
  proposal,
}: {
  proposal: Extract<AiProposal, { profile: 'repair' }>;
}): React.JSX.Element {
  const attempt = useAiStore((s) => s.lastApplyAttempt);
  const runAi = useAiStore((s) => s.run);
  const dismiss = useAiStore((s) => s.dismiss);
  const gate = evaluateApplyGate(proposal);
  const remedy = remedyFor(attempt, gate);
  const [expanded, setExpanded] = useState(false);
  const [reporting, setReporting] = useState(false);

  const retry = (): void => {
    if (attempt?.findingId !== null && attempt?.findingId !== undefined)
      void runAi('repair', attempt.findingId);
  };

  const reportBug = async (): Promise<void> => {
    setReporting(true);
    const info = await invoke('system:getAppInfo', {});
    await copyToClipboard(
      buildBugReport({
        proposal,
        attempt,
        gate,
        app: info.ok ? info.value : null,
        locale: navigator.language,
      }),
      { label: 'Bug report copied' },
    );
    setReporting(false);
  };

  return (
    <div className="shrink-0 border-t border-border-subtle bg-inset">
      {/* ── Tier 1 — what happened, and what to do about it ────────────────────────────────── */}
      {remedy !== null && (
        <div className="flex flex-col gap-2.5 border-b border-border-subtle bg-danger-subtle/25 px-3 py-3">
          <div className="flex items-start gap-2.5">
            <span className="mt-px flex size-5 shrink-0 items-center justify-center rounded-full bg-danger-subtle text-danger-text">
              <AlertIcon className="size-3" />
            </span>
            <div className="flex min-w-0 flex-col gap-1">
              <p className="text-sm font-semibold text-fg">Cannot apply repair</p>
              <p className="text-xs leading-relaxed text-fg [overflow-wrap:anywhere]">
                {remedy.reason}
              </p>
              <p className="text-xs leading-relaxed text-fg-muted [overflow-wrap:anywhere]">
                {remedy.detail}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 pl-7">
            {(remedy.kind === 'retry-repair' || remedy.kind === 'refresh-editor') && (
              <Button
                variant="primary"
                size="sm"
                onClick={retry}
                disabled={attempt?.findingId === null || attempt?.findingId === undefined}
              >
                <RefreshIcon className="size-3.5" />
                {remedy.label}
              </Button>
            )}
            {remedy.kind === 'show-verification' && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setExpanded(true);
                }}
              >
                {remedy.label}
              </Button>
            )}
            {remedy.kind === 'dismiss' && (
              <Button variant="ghost" size="sm" onClick={dismiss}>
                {remedy.label}
              </Button>
            )}
            <Button variant="ghost" size="sm" disabled={reporting} onClick={() => void reportBug()}>
              <ExternalIcon className="size-3.5" />
              {reporting ? 'Collecting…' : 'Report bug'}
            </Button>
          </div>
        </div>
      )}

      {/* ── Tier 2 — the disclosure ────────────────────────────────────────────────────────── */}
      <button
        type="button"
        onClick={() => {
          setExpanded((v) => !v);
        }}
        aria-expanded={expanded}
        className="flex w-full items-center gap-1.5 px-3 py-1.5 text-left text-[11px] text-fg-muted transition-colors duration-(--fx-motion-duration-fast) hover:text-fg focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus-ring focus-visible:outline"
      >
        {expanded ? (
          <ChevronDownIcon className="size-3 shrink-0" />
        ) : (
          <ChevronRightIcon className="size-3 shrink-0" />
        )}
        Developer details
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

      {expanded && (
        <div className="flex max-h-72 flex-col gap-2.5 overflow-y-auto border-t border-border-subtle px-3 py-3">
          <Group title="Decision">
            <Row
              label="Root cause"
              value={attempt === null ? 'Apply not attempted yet' : rootCauseOf(attempt)}
              wrap
              {...toneProp(
                attempt?.response?.applied === true ? 'ok' : remedy !== null ? 'bad' : undefined,
              )}
            />
            <Row
              label="Gate"
              value={`${gate.enabled ? 'enabled' : 'disabled'} · ${gate.reason}`}
              {...toneProp(gate.enabled ? 'ok' : 'bad')}
            />
            <Row label="Severity is an input" value="no — recorded only" {...toneProp('ok')} />
          </Group>

          <Group title="Quality gates">
            {gate.gates.length === 0 ? (
              <Row label="—" value="No repair to gate yet" />
            ) : (
              gate.gates.map((g) => (
                <Row
                  key={g.name}
                  label={g.name.charAt(0).toUpperCase() + g.name.slice(1)}
                  value={`${g.status === 'pass' ? '✓ passed' : g.status === 'fail' ? '✗ failed' : '– not run'} — ${g.detail}`}
                  wrap
                  {...toneProp(g.status === 'pass' ? 'ok' : g.status === 'fail' ? 'bad' : undefined)}
                />
              ))
            )}
          </Group>

          <Group title="Verification">
            <Row
              label="Verdict"
              value={proposal.verification.verdict}
              {...toneProp(proposal.verification.verdict === 'regression' ? 'bad' : 'ok')}
            />
            <Row label="Target resolved" value={String(proposal.verification.targetResolved)} />
            <Row
              label="New findings"
              value={String(proposal.verification.newFindingCount)}
              {...toneProp(proposal.verification.newFindingCount > 0 ? 'bad' : 'ok')}
            />
            <Row
              label="Syntax OK"
              value={String(proposal.verification.syntaxOk)}
              {...toneProp(proposal.verification.syntaxOk ? 'ok' : 'bad')}
            />
            <Row
              label="Analyzers ran"
              value={proposal.verification.ran.join(', ') || 'none'}
              wrap
            />
            {proposal.verification.note !== undefined && (
              <Row label="Note" value={proposal.verification.note} wrap />
            )}
          </Group>

          {proposal.verification.diagnostics !== undefined && (
            <Group title="Analyzer comparison">
              {/* If these two lists differ, a `regression` means the overlay ran a different toolset
                  than the workspace analysis did — the "new" findings were always there, just never
                  reported. That is a different bug from a bad patch, and only this row shows it. */}
              <Row
                label="Baseline tools"
                value={proposal.verification.diagnostics.originalSources.join(', ') || 'none'}
                wrap
              />
              <Row
                label="Overlay tools"
                value={proposal.verification.diagnostics.patchedSources.join(', ') || 'none'}
                wrap
                {...toneProp(
                  sameSet(
                    proposal.verification.diagnostics.originalSources,
                    proposal.verification.diagnostics.patchedSources,
                  )
                    ? undefined
                    : 'bad',
                )}
              />
              <Row
                label="Target signature"
                value={proposal.verification.diagnostics.targetSignature}
                mono
                wrap
              />
              <SignatureList
                label="New"
                items={proposal.verification.diagnostics.newSignatures}
                tone="bad"
              />
              <SignatureList
                label="Baseline"
                items={proposal.verification.diagnostics.originalSignatures}
              />
              <SignatureList
                label="Patched"
                items={proposal.verification.diagnostics.patchedSignatures}
              />
            </Group>
          )}

          {attempt !== null && (
            <Group title="IPC">
              <Row label="Channel" value="ai:applyRepair" mono />
              <Row label="Duration" value={`${String(attempt.durationMs ?? 0)}ms`} mono />
              <Row
                label="Request"
                value={`${attempt.request.file} · lines ${String(attempt.request.startLine)}–${String(attempt.request.endLine)} · ${String(attempt.request.code.length)} chars`}
                mono
                wrap
              />
              {attempt.transportError !== null && (
                <Row
                  label="Transport error"
                  value={attempt.transportError}
                  wrap
                  {...toneProp('bad')}
                />
              )}
              {attempt.response !== null && (
                <Row
                  label="Response"
                  value={
                    attempt.response.applied
                      ? `applied · ${String(attempt.response.bytesWritten)} bytes`
                      : `refused · ${attempt.response.reason}`
                  }
                  mono
                  {...toneProp(attempt.response.applied ? 'ok' : 'bad')}
                />
              )}
            </Group>
          )}

          {attempt?.response?.staleRangeCheck !== null &&
            attempt?.response?.staleRangeCheck !== undefined && (
              <Group title="Range check">
                <RangeCheck check={attempt.response.staleRangeCheck} />
              </Group>
            )}

          <div className="flex flex-wrap gap-2">
            <DetailButton
              onClick={() => {
                void copyToClipboard(
                  JSON.stringify(snapshot({ proposal, attempt, gate }), null, 2),
                  { label: 'Diagnostics JSON copied' },
                );
              }}
            >
              <CopyIcon className="size-3" />
              Copy JSON
            </DetailButton>
            <DetailButton
              disabled={reporting}
              onClick={() => {
                void reportBug();
              }}
            >
              <ExternalIcon className="size-3" />
              {reporting ? 'Collecting…' : 'Copy bug report'}
            </DetailButton>
          </div>
        </div>
      )}
    </div>
  );
}

function RangeCheck({ check }: { check: StaleRangeCheck }): React.JSX.Element {
  return (
    <>
      <Row
        label="Result"
        value={check.passed ? 'match' : 'MISMATCH'}
        {...toneProp(check.passed ? 'ok' : 'bad')}
      />
      <Row
        label="Range"
        value={`lines ${String(check.startLine)}–${String(check.endLine)} of ${String(check.fileLineCount)}`}
        mono
      />
      <Row
        label="Expected"
        value={`${String(check.expectedLength)} chars · sha1 ${check.expectedHash}`}
        mono
      />
      <Row
        label="On disk"
        value={`${String(check.actualLength)} chars · sha1 ${check.actualHash}`}
        mono
        {...toneProp(check.expectedHash === check.actualHash ? 'ok' : 'bad')}
      />
      {check.firstDifferingLine !== null && (
        <>
          <Row
            label="Differs at"
            value={`line ${String(check.firstDifferingLine)} of the range`}
            {...toneProp('bad')}
          />
          {/* Bounded to three lines around the difference — enough to recognise the edit, not a
              reproduction of the file. It is the user's own code, on the user's own screen. */}
          <pre className="overflow-x-auto rounded-md border border-border-subtle bg-canvas p-2 font-mono text-[10px] leading-relaxed">
            <span className="text-fg-muted">expected{'\n'}</span>
            <span className="text-danger-text">{check.expectedExcerpt || '(empty)'}</span>
            <span className="text-fg-muted">
              {'\n\n'}on disk{'\n'}
            </span>
            <span className="text-success-text">{check.actualExcerpt || '(empty)'}</span>
          </pre>
        </>
      )}
    </>
  );
}

/** The machine-readable snapshot. Code bodies reduce to lengths — shape, not content. */
function snapshot(input: {
  proposal: Extract<AiProposal, { profile: 'repair' }>;
  attempt: ApplyAttempt | null;
  gate: ApplyGate;
}): unknown {
  const { proposal, attempt, gate } = input;
  return {
    applyGate: gate,
    verification: {
      verdict: proposal.verification.verdict,
      targetResolved: proposal.verification.targetResolved,
      newFindingCount: proposal.verification.newFindingCount,
      syntaxOk: proposal.verification.syntaxOk,
      ran: proposal.verification.ran,
      note: proposal.verification.note ?? null,
      diagnostics: proposal.verification.diagnostics ?? null,
    },
    repair: {
      file: proposal.target.file,
      startLine: proposal.target.startLine,
      endLine: proposal.target.endLine,
      symbolName: proposal.target.symbolName,
      confidence: proposal.confidence,
      originalCodeLength: proposal.originalCode.length,
      repairedCodeLength: proposal.repairedCode.length,
    },
    lastAttempt:
      attempt === null
        ? null
        : {
            severityAtAttempt: attempt.findingSeverity,
            findingId: attempt.findingId,
            durationMs: attempt.durationMs,
            transportError: attempt.transportError,
            response: attempt.response,
            rootCause: rootCauseOf(attempt),
          },
  };
}

/** The snapshot plus the environment — what a maintainer needs before they can even start. */
function buildBugReport(input: {
  proposal: Extract<AiProposal, { profile: 'repair' }>;
  attempt: ApplyAttempt | null;
  gate: ApplyGate;
  app: {
    name: string;
    version: string;
    commit: string;
    platform: string;
    arch: string;
    electronVersion: string;
    isPackaged: boolean;
  } | null;
  locale: string;
}): string {
  const remedy = remedyFor(input.attempt, input.gate);
  return [
    '## Fixora bug report — repair apply',
    '',
    `**What happened:** ${remedy?.reason ?? 'Apply did not complete.'}`,
    `**Root cause:** ${input.attempt === null ? 'not attempted' : rootCauseOf(input.attempt)}`,
    '',
    '### Environment',
    '```',
    `app            ${input.app?.name ?? '?'} ${input.app?.version ?? '?'}`,
    `commit         ${input.app?.commit ?? 'unknown'}`,
    `packaged       ${String(input.app?.isPackaged ?? false)}`,
    `os             ${input.app?.platform ?? '?'} ${input.app?.arch ?? '?'}`,
    `electron       ${input.app?.electronVersion ?? '?'}`,
    `locale         ${input.locale}`,
    `file type      ${languageOf(input.proposal.target.file)}`,
    `analyzers ran  ${input.proposal.verification.ran.join(', ') || 'none'}`,
    // Stated rather than omitted. A maintainer should know this is missing, not assume it was
    // collected: tool versions live in core-analysis and are not exposed over IPC yet.
    'analyzer vers  not exposed to the renderer (core-analysis capabilities)',
    '```',
    '',
    '### Diagnostics',
    '```json',
    JSON.stringify(snapshot(input), null, 2),
    '```',
  ].join('\n');
}

function languageOf(file: string): string {
  return file.split('.').pop()?.toLowerCase() ?? 'unknown';
}

/** `exactOptionalPropertyTypes` treats an explicit `undefined` as different from an absent prop. */
function toneProp(tone: 'ok' | 'bad' | undefined): { tone?: 'ok' | 'bad' } {
  return tone === undefined ? {} : { tone };
}

function Group({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <section className="flex flex-col gap-1.5 rounded-md border border-border-subtle bg-canvas p-2.5">
      <h4 className="text-[10px] font-semibold uppercase tracking-wider text-fg-muted">{title}</h4>
      <div className="flex flex-col gap-1">{children}</div>
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
    <div className="flex gap-3 text-[11px]">
      <span className="w-28 shrink-0 text-fg-muted">{label}</span>
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

function SignatureList({
  label,
  items,
  tone,
}: {
  label: string;
  items: string[];
  tone?: 'bad';
}): React.JSX.Element {
  return (
    <div className="flex gap-3 text-[11px]">
      <span className="w-28 shrink-0 text-fg-muted">
        {label} ({items.length})
      </span>
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

function DetailButton({
  onClick,
  disabled = false,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex items-center gap-1.5 rounded-md border border-border-strong bg-raised px-2 py-1 text-[11px] font-medium text-fg-secondary transition-colors duration-(--fx-motion-duration-fast) hover:bg-hover hover:text-fg disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus-ring focus-visible:outline"
    >
      {children}
    </button>
  );
}

function sameSet(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((x) => b.includes(x));
}
