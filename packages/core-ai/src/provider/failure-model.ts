/**
 * The vocabulary of AI provider failures.
 *
 * Split out from `failure.ts` because it is a contract, not an implementation: the classifier
 * produces these values, the IPC schema mirrors them, and the status card renders them. Keeping the
 * type definitions in one small file makes the set of things that can go wrong reviewable in one
 * screen — which is the only way to keep the promise that every one of them has a recovery action.
 */

/**
 * What actually went wrong, at the granularity a user can act on.
 *
 * Finer than {@link FailureKind}, which stays as the coarse grouping older code already switches on.
 * The distinction that motivated the split: `rate-limited` and `quota-exceeded` are both HTTP 429 at
 * the transport layer and have opposite answers — one means "wait a minute", the other means "add
 * credits or switch models". Collapsing them, as we did, sent users to top up an account that was
 * merely busy.
 */
export type FailureCategory =
  | 'quota-exceeded'
  | 'rate-limited'
  | 'timeout'
  | 'invalid-api-key'
  | 'auth-failed'
  | 'provider-unavailable'
  | 'network-offline'
  | 'model-unavailable'
  | 'context-too-large'
  | 'invalid-response'
  | 'unknown-provider-error';

/**
 * Whose problem this is. The single most important field on the card.
 *
 * Users read a failed repair as "Fixora is broken" by default. Naming the layer is what corrects
 * that: a 429 is the provider's, a bad key is the user's configuration, and only `engine` is ours.
 * Nothing in this module may attribute a provider failure to the engine.
 */
export type FailureLayer =
  /** The provider refused, stalled, or is down. Not Fixora, not the user. */
  | 'provider'
  /** The user's key, model choice, or credits. Fixable in Settings → AI. */
  | 'configuration'
  /** Fixora itself. Reserved — the provider pipeline never produces this. */
  | 'engine';

/** Warning for things that may pass on their own; danger for things that need a decision. */
export type FailureSeverity = 'warning' | 'danger';

/**
 * A recovery affordance. A closed set rather than free text, so the card cannot offer an action the
 * shell has no handler for, and so "every failure has at least one action" is testable.
 */
export type RecoveryAction =
  /** Re-run the same request now. Only offered when that could plausibly succeed. */
  | 'retry'
  /** Re-run later — the condition clears on its own, but not within a click. */
  | 'retry-later'
  | 'open-settings'
  | 'change-model'
  | 'check-credits'
  | 'check-connection'
  /** Move to the next configured provider without leaving the repair. */
  | 'switch-provider'
  /** Open the provider's own dashboard, where quota and billing actually live. */
  | 'open-dashboard';

export const RECOVERY_ACTION_LABEL: Record<RecoveryAction, string> = {
  retry: 'Retry',
  'retry-later': 'Retry later',
  'open-settings': 'Open AI Settings',
  'change-model': 'Select another configured model',
  'check-credits': 'Check API credits',
  'check-connection': 'Check your network connection',
  'switch-provider': 'Switch provider',
  'open-dashboard': 'Open provider dashboard',
};

/** Short status words for the card's Status row — the category, said in the user's language. */
export const FAILURE_STATUS_LABEL: Record<FailureCategory, string> = {
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

/** How the card names the responsible layer, so the user is never left guessing whom to chase. */
export const FAILURE_LAYER_LABEL: Record<FailureLayer, string> = {
  provider: 'AI provider',
  configuration: 'Your configuration',
  engine: 'Fixora',
};
