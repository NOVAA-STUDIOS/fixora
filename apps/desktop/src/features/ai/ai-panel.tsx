import { Button } from '@fixora/ui';

import { useAiStore } from '../../stores/ai-store.js';

/**
 * The AI result surface (M5, Phase C). It shows the active run: streamed prose for an explanation, the
 * structured proposal for a repair or a generated test, or a typed failure — a gate block that names the
 * file and rule, or a provider error with the next step. The verified-diff view + apply arrive in Phase D;
 * for now a repair shows its rationale, confidence, and the replacement code.
 */
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

  return (
    <section
      aria-label="AI result"
      className="flex max-h-[45%] shrink-0 flex-col border-t border-border-subtle bg-canvas"
    >
      <header className="flex h-8 shrink-0 items-center justify-between border-b border-border-subtle px-3">
        <span className="text-xs font-semibold capitalize text-fg">
          {profile ?? 'AI'}
          {status === 'running' && <span className="ml-2 text-fg-muted">running…</span>}
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

        {status === 'done' && proposal?.profile === 'repair' && (
          <div className="flex flex-col gap-2">
            <p>{proposal.rationale}</p>
            <p className="text-fg-muted">
              Confidence: {Math.round(proposal.confidence * 100)}% ·{' '}
              {proposal.target.symbolName ?? 'selection'} (lines {proposal.target.startLine}–
              {proposal.target.endLine})
            </p>
            <pre className="overflow-x-auto rounded bg-hover p-2 font-mono text-[11px] text-fg">
              {proposal.repairedCode}
            </pre>
          </div>
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
    </section>
  );
}
