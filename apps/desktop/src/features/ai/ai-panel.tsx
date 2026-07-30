import type { AiRunStage } from '@fixora/shared-types';
import { Button } from '@fixora/ui';
import { useEffect } from 'react';

import { useAiStore } from '../../stores/ai-store.js';
import { useUiStore } from '../../stores/ui-store.js';
import { useFindingsStore } from '../findings/findings-store.js';
import { ProblemDetails } from '../findings/problem-details.js';

import { ProviderErrorCard } from './provider-error-card.js';
import { RepairResult } from './repair-result.js';
import { VerdictBadge } from './verdict-badge.js';

/**
 * The AI result surface (M5), mounted in the workbench's AI pane. It shows the active run: streamed
 * prose for an explanation, a generated test, or — the heart of the product — a **verified repair**:
 * the diff, its verdict, and the actions. A repair is never shown without its verification report
 * (ADR-003). It also owns loading the BYOK config + the delta subscription, since it is always mounted.
 */

/** What each phase is called in the header while a run is in flight. */
const STAGE_LABEL: Record<AiRunStage, string> = {
  preparing: 'Preparing repair…',
  analyzing: 'Analyzing…',
  generating: 'Generating patch…',
  // Automatic failover. Named plainly so a several-second recovery reads as Fixora working, not
  // as Fixora stuck — the user is never asked to switch models by hand.
  'failing-over': 'Trying a backup model…',
  validating: 'Validating…',
  applying: 'Applying…',
};

export function AiPanel(): React.JSX.Element {
  const status = useAiStore((s) => s.status);
  const stage = useAiStore((s) => s.stage);
  const profile = useAiStore((s) => s.activeProfile);
  const streamText = useAiStore((s) => s.streamText);
  const proposal = useAiStore((s) => s.proposal);
  const blocked = useAiStore((s) => s.blocked);
  const errorMessage = useAiStore((s) => s.errorMessage);
  const retryable = useAiStore((s) => s.retryable);
  const failure = useAiStore((s) => s.failure);
  const goToSettings = useUiStore((s) => s.setActiveView);
  const configured = useAiStore((s) => s.config?.configured ?? false);
  const cancel = useAiStore((s) => s.cancel);
  const dismiss = useAiStore((s) => s.dismiss);
  const retry = useAiStore((s) => s.retry);
  const loadConfig = useAiStore((s) => s.loadConfig);
  const listen = useAiStore((s) => s.listen);

  // When no run is active the pane is the *problem details* view: everything known about the
  // selected finding, right above the buttons that act on it. Understand first, then spend a token.
  const selected = useFindingsStore((s) => s.findings.find((f) => f.id === s.selectedId) ?? null);

  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);
  useEffect(() => listen(), [listen]);

  // Narrowed once so the repair branch (badge + diff) is type-safe without redundant checks.
  const repair = status === 'done' && proposal?.profile === 'repair' ? proposal : null;

  return (
    <section
      aria-label="Assistant"
      className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-border-subtle bg-raised"
    >
      <header className="flex h-9 shrink-0 items-center justify-between gap-2 border-b border-border-subtle px-3">
        <h2 className="flex min-w-0 items-center gap-2 truncate text-[11px] font-semibold uppercase tracking-wider text-fg-secondary">
          {status === 'idle'
            ? selected !== null
              ? 'Problem details'
              : 'Assistant'
            : (profile ?? 'AI')}
          {status === 'running' && (
            // Names the phase, not just "running". An undifferentiated spinner made a slow repair
            // indistinguishable from a hung one — the reported symptom behind the P0 hang.
            <span className="text-fg-muted">{STAGE_LABEL[stage ?? 'preparing']}</span>
          )}
          {repair !== null && <VerdictBadge verdict={repair.verification.verdict} />}
        </h2>
        {status === 'running' ? (
          <Button variant="ghost" size="sm" className="shrink-0" onClick={() => void cancel()}>
            Cancel
          </Button>
        ) : (
          status !== 'idle' && (
            <Button variant="ghost" size="sm" className="shrink-0" onClick={dismiss}>
              Dismiss
            </Button>
          )
        )}
      </header>

      {status === 'idle' ? (
        selected !== null ? (
          <ProblemDetails finding={selected} />
        ) : (
          <IdleGuide configured={configured} />
        )
      ) : repair !== null ? (
        <RepairResult proposal={repair} finding={selected} />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto p-3 text-xs text-fg-secondary">
          {status === 'blocked' && blocked !== null && (
            <div className="flex flex-col gap-1 text-danger-text">
              <p className="font-semibold [overflow-wrap:anywhere]">
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

          {/* A failed run is a status card, not a red sentence. The card names the layer, the
              provider and the model, and always offers at least one recovery action — see
              `provider-error-card.tsx` for why a bare sentence was not enough. */}
          {status === 'error' && errorMessage !== null && (
            <ProviderErrorCard
              failure={failure}
              reason={errorMessage}
              retryable={retryable}
              onRetry={() => void retry()}
              onOpenSettings={() => {
                goToSettings('settings');
              }}
            />
          )}

          {/* overflow-wrap:anywhere as well as pre-wrap: pre-wrap breaks at whitespace, and model
              prose routinely contains things with none — a bare URL, a long import path, a minified
              identifier. Without it one such token forces the whole assistant pane to scroll
              sideways, which at this pane's width is most of the time. */}
          {(profile === 'explain' || status === 'running') && streamText.length > 0 && (
            <pre className="whitespace-pre-wrap font-sans [overflow-wrap:anywhere]">
              {streamText}
            </pre>
          )}

          {status === 'done' && proposal?.profile === 'explain' && (
            <pre className="whitespace-pre-wrap font-sans [overflow-wrap:anywhere]">
              {proposal.explanation}
            </pre>
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

/**
 * The idle assistant pane. A first-time user should never have to guess what to do here, so it states
 * the next step and gives them the button for it — set up a key, or go pick a finding to repair.
 */
function IdleGuide({ configured }: { configured: boolean }): React.JSX.Element {
  const setActiveView = useUiStore((s) => s.setActiveView);

  if (!configured) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
        <p className="text-sm font-medium text-fg">Set up AI to repair code</p>
        <p className="max-w-xs text-xs text-fg-muted">
          Fixora uses your own provider key. Your code goes straight to the provider you choose —
          never through a Fixora server.
        </p>
        <Button
          variant="primary"
          size="sm"
          className="mt-1"
          onClick={() => {
            setActiveView('settings');
          }}
        >
          Add your API key
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
      <p className="text-sm font-medium text-fg">Ready to repair</p>
      <p className="max-w-xs text-xs text-fg-muted">
        Pick a finding in Problems, then choose <span className="text-fg-secondary">Explain</span>,{' '}
        <span className="text-fg-secondary">Repair</span>, or{' '}
        <span className="text-fg-secondary">Test</span>. Every repair is verified before you apply
        it.
      </p>
      <Button
        variant="ghost"
        size="sm"
        className="mt-1"
        onClick={() => {
          setActiveView('findings');
        }}
      >
        Go to Problems
      </Button>
    </div>
  );
}
