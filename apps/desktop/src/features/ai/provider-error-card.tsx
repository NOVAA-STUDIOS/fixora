import type { AiFailure, AiRecoveryAction } from '@fixora/shared-types';
import { Button, cn } from '@fixora/ui';

/**
 * The AI provider failure card.
 *
 * The panel used to render a bare red sentence — "Your OpenRouter quota has been exhausted." — and a
 * Retry button that appeared only sometimes. Technically correct, and it left three questions
 * unanswered every time: is this Fixora or the provider, which model was even being used, and what am
 * I supposed to do now. Users read an unattributed failure as a Fixora defect by default, so a
 * provider outage cost us bug reports and trust we had not actually lost.
 *
 * The card answers all three, in that order: what happened, whose problem it is, what to do next.
 *
 * Two rules hold structurally rather than by review:
 *
 *  - **It always renders something.** `reason` is required, so there is no input for which this
 *    component produces an empty panel.
 *  - **It always offers a way forward.** The action list is non-empty at the schema, and the reduced
 *    form (no classification available) hard-codes Retry. There is no path to a dead end.
 *
 * Severity is derived from the classification, never passed in: warning for something that may pass
 * on its own, danger for something the user must decide about. Deriving it is what stops a future
 * category from being styled by whichever felt right that afternoon.
 */

const STATUS_LABEL: Record<AiFailure['category'], string> = {
  'quota-exceeded': 'Quota exceeded',
  'rate-limited': 'Rate limited',
  timeout: 'Timed out',
  'invalid-api-key': 'Invalid API key',
  'auth-failed': 'Authentication failed',
  'provider-unavailable': 'Provider unavailable',
  'network-offline': 'Network offline',
  'model-unavailable': 'Model unavailable',
  'context-too-large': 'Context too large',
  'invalid-response': 'Invalid response',
  'unknown-provider-error': 'Unknown provider error',
};

/**
 * Whose problem this is, said plainly.
 *
 * The single most valuable line on the card. "AI provider" tells a user not to file a Fixora bug and
 * not to re-check their key; "Your configuration" tells them the opposite. Getting this wrong is
 * worse than omitting it, which is why nothing in the provider pipeline may report `engine`.
 */
const LAYER_LABEL: Record<AiFailure['layer'], string> = {
  provider: 'AI provider — not Fixora',
  configuration: 'Your Fixora configuration',
  engine: 'Fixora',
};

const ACTION_LABEL: Record<AiRecoveryAction, string> = {
  retry: 'Retry now',
  'retry-later': 'Try again in a few minutes',
  'open-settings': 'Open AI Settings',
  'change-model': 'Select another configured model',
  'check-credits': 'Check your API credits with the provider',
  'check-connection': 'Check your internet connection or VPN',
};

/** Severity drives styling only. Configuration problems need a decision; the rest may clear alone. */
function severityOf(failure: AiFailure): 'warning' | 'danger' {
  if (failure.layer === 'configuration') return 'danger';
  return failure.actions.includes('retry') ? 'warning' : 'danger';
}

export interface ProviderErrorCardProps {
  /** The classified failure. Null when the run failed before classification (e.g. an IPC drop). */
  failure: AiFailure | null;
  /** The user-facing sentence. Always present — this is what guarantees a non-empty panel. */
  reason: string;
  /** Whether re-running the same request could plausibly succeed. */
  retryable: boolean;
  onRetry: () => void;
  onOpenSettings: () => void;
}

export function ProviderErrorCard({
  failure,
  reason,
  retryable,
  onRetry,
  onOpenSettings,
}: ProviderErrorCardProps): React.JSX.Element {
  const severity = failure === null ? 'warning' : severityOf(failure);
  const danger = severity === 'danger';

  // Buttons are the subset of the recovery list that the shell can actually perform. "Change model"
  // and "Open settings" are the same destination today, so they collapse into one control rather
  // than two buttons that do the same thing — a distinction the suggestion list still makes, because
  // there the wording is the advice.
  const actions = failure?.actions ?? [];
  const showRetry = retryable || actions.includes('retry');
  const showSettings =
    failure === null ||
    actions.includes('open-settings') ||
    actions.includes('change-model') ||
    actions.includes('check-credits');
  const changesModel = actions.includes('change-model') && !actions.includes('open-settings');

  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col gap-3 rounded-md border p-3',
        danger ? 'border-danger-border bg-danger-subtle' : 'border-warn-border bg-warn-subtle',
      )}
    >
      <div className="flex flex-col gap-0.5">
        <h3
          className={cn(
            'text-xs font-semibold',
            danger ? 'text-danger-text' : 'text-warn-text',
          )}
        >
          AI Repair Unavailable
        </h3>
        {/* The one line that stops a provider outage from being read as a Fixora defect. */}
        <p className="text-[10px] uppercase tracking-wide text-fg-muted">
          {failure === null ? 'Fixora' : LAYER_LABEL[failure.layer]}
        </p>
      </div>

      <Field label="Reason">
        <span className="[overflow-wrap:anywhere]">{reason}</span>
      </Field>

      {failure !== null && (
        <>
          <Field label="Provider">{failure.provider}</Field>
          {/* The model id verbatim: it is the string the user would change, and a prettified version
              would not match what Settings shows them. */}
          <Field label="Model">
            <code className="font-mono text-[11px] [overflow-wrap:anywhere]">{failure.model}</code>
          </Field>
          <Field label="Status">{STATUS_LABEL[failure.category]}</Field>
          {/* One consolidated card for a whole failed walk. Without this the user sees a single
              model named and has no idea Fixora already tried several on their behalf — which makes
              automatic failover look like it never happened. */}
          {failure.attempts.length > 0 && (
            <Field label={`Also tried (${String(failure.attempts.length)})`}>
              <ul className="flex flex-col gap-0.5">
                {failure.attempts.map((attempt) => (
                  <li key={attempt.model} className="[overflow-wrap:anywhere]">
                    <code className="font-mono text-[11px]">{attempt.model}</code>
                    <span className="text-fg-muted"> — {STATUS_LABEL[attempt.category]}</span>
                  </li>
                ))}
              </ul>
            </Field>
          )}
        </>
      )}

      {actions.length > 0 && (
        <div className="flex flex-col gap-1">
          <p className="text-[10px] font-medium uppercase tracking-wide text-fg-muted">
            Suggested actions
          </p>
          <ul className="flex list-disc flex-col gap-0.5 pl-4 text-[11px] text-fg-secondary">
            {actions.map((action) => (
              <li key={action}>{ACTION_LABEL[action]}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {showRetry && (
          <Button type="button" size="sm" variant="secondary" onClick={onRetry}>
            Retry
          </Button>
        )}
        {showSettings && (
          <Button type="button" size="sm" variant="ghost" onClick={onOpenSettings}>
            {changesModel ? 'Change Model' : 'Open Settings'}
          </Button>
        )}
      </div>

      {/* Says where the detail went, without showing any of it. Users who report bugs need to know a
          trace exists; users who don't need never see a status code. */}
      <p className="text-[10px] text-fg-muted">
        Technical details for this failure are in the developer log.
      </p>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-0.5">
      <p className="text-[10px] font-medium uppercase tracking-wide text-fg-muted">{label}</p>
      <p className="text-[11px] leading-snug text-fg">{children}</p>
    </div>
  );
}
