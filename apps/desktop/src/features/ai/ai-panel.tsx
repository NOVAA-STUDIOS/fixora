import { FOLLOWUP_MAX_MESSAGES, type AiRunStage } from '@fixora/shared-types';
import { Button, cn } from '@fixora/ui';
import { useEffect, useState } from 'react';

import { useAiStore } from '../../stores/ai-store.js';
import { useUiStore } from '../../stores/ui-store.js';
import { useFindingsStore } from '../findings/findings-store.js';
import { ProblemDetails } from '../findings/problem-details.js';

import { partialRepairedCode } from './partial-repair.js';
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
  // Automatic failover — now across providers, not just models on one key. Named plainly so a
  // several-second recovery reads as Fixora working, not as Fixora stuck — the user is never asked
  // to switch providers or models by hand.
  'failing-over': 'Provider unavailable — trying another…',
  validating: 'Validating…',
  applying: 'Applying…',
};

export function AiPanel(): React.JSX.Element {
  const status = useAiStore((s) => s.status);
  const stage = useAiStore((s) => s.stage);
  const profile = useAiStore((s) => s.activeProfile);
  const streamText = useAiStore((s) => s.streamText);
  // Derived on render rather than stored: it is a pure function of the buffer, and keeping a second
  // copy in the store would be two things to keep in step for no gain.
  const repairPreview = partialRepairedCode(streamText);
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
    // `App.tsx` already fetches this once at mount; only fetch here if that hasn't landed yet
    // (or this panel somehow mounted first), so navigating here doesn't always re-fetch.
    if (useAiStore.getState().config === null) void loadConfig();
  }, [loadConfig]);
  useEffect(() => listen(), [listen]);

  // Narrowed once so the repair branch (badge + diff) is type-safe without redundant checks.
  const repair = status === 'done' && proposal?.profile === 'repair' ? proposal : null;

  // A large file's verification pass can run long enough to read as a hang. This says so — after
  // 15s, not immediately — rather than leaving the stage label as the only signal something is
  // still happening.
  const [showSlowVerifyMessage, setShowSlowVerifyMessage] = useState(false);
  useEffect(() => {
    if (stage !== 'validating') {
      setShowSlowVerifyMessage(false);
      return;
    }
    const timer = setTimeout(() => {
      setShowSlowVerifyMessage(true);
    }, 15_000);
    return () => {
      clearTimeout(timer);
    };
  }, [stage]);

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

      {status === 'running' && stage === 'validating' && showSlowVerifyMessage && (
        <p className="shrink-0 px-3 pt-1.5 text-[11px] text-fg-muted">
          This is taking longer than usual — large files take more time to verify.
        </p>
      )}

      {status === 'idle' ? (
        selected !== null ? (
          <ProblemDetails finding={selected} />
        ) : (
          <IdleGuide configured={configured} />
        )
      ) : repair !== null ? (
        <RepairResult proposal={repair} finding={selected} />
      ) : (
        /* `relative` for the same reason as the settings scroller: `sr-only` is absolutely
           positioned, and the provider error card renders one per status check. Without a
           positioned ancestor they resolve against the initial containing block and add blank
           scroll to the whole window. */
        <div className="relative min-h-0 flex-1 overflow-y-auto p-3 text-xs text-fg-secondary">
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
          {profile === 'explain' && streamText.length > 0 && <ExplainText text={streamText} />}

          {/*
            A repair in flight. The raw stream is a JSON object, which is not something to show a
            user, so what is rendered is the repaired code being read out of it as it arrives — the
            same bytes, minus the envelope. Preview only: it is never the patch, and Accept still
            waits on the parsed, verified result.
          */}
          {profile !== 'explain' && status === 'running' && repairPreview.length > 0 && (
            <pre className="max-h-64 overflow-auto rounded bg-inset p-2 font-mono text-[11px] whitespace-pre-wrap [overflow-wrap:anywhere] text-fg-secondary">
              {repairPreview}
            </pre>
          )}

          {status === 'done' && proposal?.profile === 'explain' && (
            <>
              <ExplainText text={proposal.explanation} />
              <FollowUpChat />
            </>
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

/**
 * The explanation, with its `**bold**` labels rendered.
 *
 * The explain prompt emits four bolded section headers (`🔴 **What's wrong**`, and so on). Shown in
 * a plain `<pre>` those asterisks render literally, which reads as broken output — the one thing a
 * beginner-facing explanation cannot afford. This handles exactly the subset that prompt produces
 * rather than pulling in a markdown renderer: a dependency parsing model output inside the app's
 * most privileged surface is a much larger commitment than four bold labels justify.
 *
 * Everything is rendered as TEXT — `**` only ever selects which `<span>` a run of characters lands
 * in, and no branch interprets model output as markup. It cannot inject an element.
 */
export function ExplainText({ text }: { text: string }): React.JSX.Element {
  // Split on the delimiter itself so the segments alternate plain/bold — odd indices are the
  // emphasised runs. An unterminated `**` (mid-stream, which happens on every keystroke of a
  // streaming response) simply leaves a trailing plain segment rather than swallowing the rest.
  const segments = text.split('**');
  return (
    <pre className="whitespace-pre-wrap font-sans [overflow-wrap:anywhere]">
      {segments.map((segment, index) =>
        index % 2 === 1 ? (
          <span key={index} className="font-semibold text-fg">
            {segment}
          </span>
        ) : (
          segment
        ),
      )}
    </pre>
  );
}

/**
 * Follow-up questions about the explanation above.
 *
 * Every question is answered against the SAME grounded context the explanation used — main rebuilds
 * the real file and the exact finding for each one (`ai-service.ts`), so an answer five turns in is
 * still describing the user's actual code rather than the transcript. Free, like Explain itself:
 * `ai:run` meters `profile: 'repair'` only.
 */
function FollowUpChat(): React.JSX.Element {
  const followUps = useAiStore((s) => s.followUps);
  const pending = useAiStore((s) => s.followUpPending);
  const ask = useAiStore((s) => s.askFollowUp);
  const [question, setQuestion] = useState('');

  const atCap = followUps.length >= FOLLOWUP_MAX_MESSAGES;

  const send = (): void => {
    const trimmed = question.trim();
    if (trimmed === '' || pending || atCap) return;
    setQuestion('');
    void ask(trimmed);
  };

  return (
    <div className="mt-4 flex flex-col gap-2 border-t border-border-subtle pt-3">
      {followUps.map((turn, index) => (
        <div
          key={index}
          className={cn(
            'rounded-lg px-2.5 py-1.5 text-xs leading-relaxed [overflow-wrap:anywhere]',
            turn.role === 'user'
              ? 'self-end bg-accent-subtle text-accent-text'
              : 'bg-inset text-fg-secondary',
          )}
        >
          {turn.role === 'assistant' ? <ExplainText text={turn.content} /> : turn.content}
        </div>
      ))}

      {pending && <p className="text-xs text-fg-muted">Thinking…</p>}

      {atCap ? (
        <p className="text-xs text-fg-muted">
          That&apos;s the end of this thread. Run Explain again to start a new one.
        </p>
      ) : (
        <div className="flex items-center gap-1.5">
          <input
            value={question}
            onChange={(e) => {
              setQuestion(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            disabled={pending}
            placeholder="Ask anything about this issue…"
            className="min-w-0 flex-1 rounded-lg border border-border-strong bg-inset px-2.5 py-1.5 text-xs text-fg placeholder:text-fg-muted disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-focus-ring focus-visible:outline"
          />
          <Button
            variant="ghost"
            size="sm"
            className="shrink-0"
            disabled={pending || question.trim() === ''}
            onClick={send}
          >
            Send
          </Button>
        </div>
      )}
    </div>
  );
}
