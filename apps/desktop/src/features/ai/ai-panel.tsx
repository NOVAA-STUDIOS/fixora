import type { AiProposal, Verdict } from '@fixora/shared-types';
import { Button, cn } from '@fixora/ui';

import { useAiStore } from '../../stores/ai-store.js';
import { DiffEditor } from '../editor/diff-editor.js';

/**
 * The AI result surface (M5). It shows the active run: streamed prose for an explanation, a generated
 * test, or — the heart of the product — a **verified repair**: the diff, its verdict, and the actions.
 * A repair is never shown without its verification report (ADR-003), so the verdict badge is always
 * present and honest about what ran.
 */

const VERDICT_STYLE: Record<Verdict, { label: string; className: string }> = {
  verified: { label: 'Verified', className: 'bg-success-bg text-success-text' },
  regression: { label: 'Regression detected', className: 'bg-danger-bg text-danger-text' },
  unresolved: { label: 'Unresolved', className: 'bg-warning-bg text-fg-secondary' },
  skipped: { label: 'Not verified', className: 'bg-hover text-fg-muted' },
};

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
};

function monacoLanguage(file: string): string {
  return MONACO_LANG[file.split('.').pop()?.toLowerCase() ?? ''] ?? 'plaintext';
}

export function AiPanel(): React.JSX.Element | null {
  const status = useAiStore((s) => s.status);
  const profile = useAiStore((s) => s.activeProfile);
  const streamText = useAiStore((s) => s.streamText);
  const proposal = useAiStore((s) => s.proposal);
  const blocked = useAiStore((s) => s.blocked);
  const errorMessage = useAiStore((s) => s.errorMessage);
  const cancel = useAiStore((s) => s.cancel);
  const dismiss = useAiStore((s) => s.dismiss);

  if (status === 'idle') return null;

  // Narrowed once so the repair branch (badge + diff) is type-safe without redundant checks.
  const repair = status === 'done' && proposal?.profile === 'repair' ? proposal : null;

  return (
    <section
      aria-label="AI result"
      className="flex max-h-[55%] min-h-[8rem] shrink-0 flex-col border-t border-border-subtle bg-canvas"
    >
      <header className="flex h-8 shrink-0 items-center justify-between border-b border-border-subtle px-3">
        <span className="flex items-center gap-2 text-xs font-semibold capitalize text-fg">
          {profile ?? 'AI'}
          {status === 'running' && <span className="text-fg-muted">running…</span>}
          {repair !== null && <VerdictBadge verdict={repair.verification.verdict} />}
        </span>
        {status === 'running' ? (
          <Button variant="ghost" size="sm" onClick={() => void cancel()}>
            Cancel
          </Button>
        ) : (
          <Button variant="ghost" size="sm" onClick={dismiss}>
            Dismiss
          </Button>
        )}
      </header>

      {repair !== null ? (
        <RepairResult proposal={repair} />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto p-3 text-xs text-fg-secondary">
          {status === 'blocked' && blocked !== null && (
            <div className="flex flex-col gap-1 text-danger-text">
              <p className="font-semibold">
                Blocked: a secret was detected. Nothing was sent to the provider.
              </p>
              <ul className="list-disc pl-5">
                {blocked.map((m, i) => (
                  <li key={i}>
                    <span className="font-medium">{m.label}</span> — {m.rule} ({m.kind})
                  </li>
                ))}
              </ul>
            </div>
          )}

          {status === 'error' && errorMessage !== null && (
            <p className="text-danger-text">{errorMessage}</p>
          )}

          {(profile === 'explain' || status === 'running') && streamText.length > 0 && (
            <pre className="whitespace-pre-wrap font-sans">{streamText}</pre>
          )}

          {status === 'done' && proposal?.profile === 'explain' && (
            <pre className="whitespace-pre-wrap font-sans">{proposal.explanation}</pre>
          )}

          {status === 'done' && proposal?.profile === 'test' && (
            <div className="flex flex-col gap-2">
              <p className="text-fg-muted">Framework: {proposal.framework}</p>
              <p>{proposal.rationale}</p>
              <pre className="overflow-x-auto rounded bg-hover p-2 font-mono text-[11px] text-fg">
                {proposal.testCode}
              </pre>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function VerdictBadge({ verdict }: { verdict: Verdict }): React.JSX.Element {
  const style = VERDICT_STYLE[verdict];
  return (
    <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-medium normal-case', style.className)}>
      {style.label}
    </span>
  );
}

function RepairResult({
  proposal,
}: {
  proposal: Extract<AiProposal, { profile: 'repair' }>;
}): React.JSX.Element {
  const applyRepair = useAiStore((s) => s.applyRepair);
  const dismiss = useAiStore((s) => s.dismiss);
  const report = proposal.verification;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 border-b border-border-subtle px-3 py-2 text-xs text-fg-secondary">
        <p>{proposal.rationale}</p>
        <p className="mt-1 text-fg-muted">
          Confidence {Math.round(proposal.confidence * 100)}% · verified against{' '}
          {report.ran.join(', ')}
          {report.note !== undefined && ` · ${report.note}`}
        </p>
      </div>

      <div className="min-h-0 flex-1">
        <DiffEditor
          original={proposal.originalCode}
          modified={proposal.repairedCode}
          language={monacoLanguage(proposal.target.file)}
        />
      </div>

      <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border-subtle px-3 py-2">
        <Button variant="ghost" size="sm" onClick={dismiss}>
          Reject
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void navigator.clipboard.writeText(proposal.repairedCode)}
        >
          Copy
        </Button>
        <Button
          size="sm"
          disabled={report.verdict === 'regression'}
          title={
            report.verdict === 'regression'
              ? 'This fix introduces a new problem and cannot be applied.'
              : undefined
          }
          onClick={() => void applyRepair()}
        >
          Apply
        </Button>
      </div>
    </div>
  );
}
