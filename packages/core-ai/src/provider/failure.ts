/**
 * Provider failure classification (P2.2.1).
 *
 * The adapter reports the provider's own words plus a machine code (`HTTP_429`, `NETWORK`, …). That
 * is exactly right for logs and exactly wrong for a panel: users were shown raw transport strings like
 * "429 Too Many Requests — Rate limit exceeded: free-models-per-day. Add 10 credits to unlock 1000
 * free model requests per day (HTTP_429)". This turns that into (a) which layer actually failed and
 * (b) a sentence the user can act on — without inventing a cause the provider did not state.
 *
 * Pure and shared: both the repair path and Proceed classify failures the same way, so the two never
 * disagree about what a 429 means.
 */

/** Which layer failed. Keeps "the provider refused us" distinct from "the model wrote nonsense". */
export type FailureKind =
  /** Quota / rate limit — the account is out of allowance for now. */
  | 'quota'
  /** The key is missing, wrong, or not entitled. */
  | 'auth'
  /** The selected model is gone, unknown, or refuses this request shape. */
  | 'model'
  /** Transport: offline, DNS, TLS, dropped stream. */
  | 'network'
  /** The provider is up but erroring (5xx) — theirs, not ours. */
  | 'provider'
  /** The model answered, but not with something we could use. */
  | 'model-output';

export interface ProviderFailure {
  readonly kind: FailureKind;
  /** One sentence, addressed to the user, that says what to do next. Never a raw HTTP string. */
  readonly message: string;
  /** Whether retrying the same request could plausibly succeed (drives a Retry affordance). */
  readonly retryable: boolean;
  /** The provider's own code, preserved for logs and bug reports — not shown as the headline. */
  readonly providerCode: string;
}

const QUOTA_MESSAGE =
  'Your OpenRouter quota has been exhausted. Please wait until the quota resets or select another model.';

/**
 * Classify a provider error event. `providerCode` is the adapter's code; `detail` is the provider's
 * own message, which is appended only where it adds something the headline does not already say.
 */
export function describeProviderFailure(input: {
  providerCode: string;
  detail?: string;
  retryable?: boolean;
}): ProviderFailure {
  const code = input.providerCode.toUpperCase();
  const status = /^HTTP_(\d{3})$/.exec(code)?.[1];
  const detail = (input.detail ?? '').trim();

  if (status === '429') {
    return { kind: 'quota', message: QUOTA_MESSAGE, retryable: true, providerCode: code };
  }
  if (status === '402') {
    return {
      kind: 'quota',
      message:
        'Your OpenRouter account is out of credits. Add credits, or switch to a free model in Settings → AI.',
      retryable: false,
      providerCode: code,
    };
  }
  if (status === '401' || status === '403') {
    return {
      kind: 'auth',
      message:
        'Your provider key was rejected. Check the key in Settings → AI — it may be revoked or lack access to this model.',
      retryable: false,
      providerCode: code,
    };
  }
  if (status === '404') {
    return {
      kind: 'model',
      message:
        'That model is no longer available from the provider. Pick another model in Settings → AI.',
      retryable: false,
      providerCode: code,
    };
  }
  if (status !== undefined && Number(status) >= 500) {
    return {
      kind: 'provider',
      message: `The provider is having trouble right now (HTTP ${status}). This is on their side — try again shortly.`,
      retryable: true,
      providerCode: code,
    };
  }
  if (code === 'NETWORK' || code === 'NO_BODY' || code === 'STREAM') {
    return {
      kind: 'network',
      message:
        'Could not reach the provider. Check your connection and try again — nothing was changed.',
      retryable: true,
      providerCode: code,
    };
  }

  // Anything else: carry the provider's own words rather than inventing a cause.
  return {
    kind: 'provider',
    message:
      detail === ''
        ? `The provider refused the request (${code}).`
        : `The provider refused the request: ${detail}`,
    retryable: input.retryable ?? false,
    providerCode: code,
  };
}

/** The model replied, but not with usable output. Distinct from the provider failing to reply. */
export function describeModelOutputFailure(reason: string, detail = ''): ProviderFailure {
  const trimmed = detail.trim();
  const message =
    reason === 'empty'
      ? 'The model returned an empty response. This usually means the model is overloaded or too small for the task — try again, or pick a stronger model in Settings → AI.'
      : `The model's answer did not match the required format (${reason})${
          trimmed === '' ? '' : `: ${trimmed}`
        }. Try again, or pick a stronger model in Settings → AI.`;
  return { kind: 'model-output', message, retryable: true, providerCode: `MODEL_${reason}` };
}
