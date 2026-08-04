import {
  describeProviderFailure,
  providerDescriptor,
  severityOf,
  type ProviderFailure,
} from '@fixora/core-ai';
import type { AiFailure } from '@fixora/shared-types';

/**
 * The two halves of a provider failure, kept deliberately apart.
 *
 * A failure has a user half — what happened, whose fault, what to do — and a diagnostic half: status
 * code, request id, latency, the provider's own words. Both are necessary; mixing them is what
 * produced the original complaint. Users got transport dumps in a panel, while the fields an engineer
 * actually needed to chase a 429 (the request id, the latency, the model) were nowhere at all.
 *
 * So: {@link toWireFailure} builds the half that crosses IPC, and it structurally cannot carry
 * diagnostics — there is no field for them. {@link logProviderFailure} writes the other half to the
 * developer log, where it never reaches a user. The boundary is the type, not a convention.
 */

/** Human-readable provider name for the card's Provider row. Only one provider ships today. */
const PROVIDER_LABEL: Record<string, string> = { openrouter: 'OpenRouter' };

export function providerLabel(id: string): string {
  return PROVIDER_LABEL[id.toLowerCase()] ?? id;
}

/** The renderable half: classification, blame, and recovery. Never a status code or raw text. */
export function toWireFailure(
  failure: ProviderFailure,
  context: {
    provider: string;
    model: string;
    /** Models tried before this failure, when automatic failover walked a chain. */
    attempts?: readonly { model: string; category: AiFailure['category'] }[];
  },
): AiFailure {
  return {
    category: failure.category,
    layer: failure.layer,
    // The schema requires at least one action. The classifier guarantees it, but a wire schema
    // violation would be redacted by the router into "Something went wrong" — losing the very
    // message this feature exists to deliver. So the guarantee is re-asserted here rather than
    // assumed across a package boundary.
    actions: failure.actions.length > 0 ? [...failure.actions] : (['open-settings'] as const),
    // The provider's own numbers, when it sent them. Absent stays absent — an invented reset time is
    // worse than none, because the user plans around it.
    /**
     * Picked field by field, never spread.
     *
     * A spread carries whatever the adapter happened to parse — including the provider's free-text
     * `remedy`, which is unbounded vendor copy and has no business in Fixora's UI. Removing it from
     * the wire SCHEMA is not enough: this object is constructed, not parsed, so zod strips nothing.
     * The boundary is here, and it is explicit so a new field on RateLimitFacts cannot cross by
     * accident — it has to be added on this line, deliberately.
     */
    ...(failure.rateLimit === undefined
      ? {}
      : {
          rateLimit: {
            ...(failure.rateLimit.limit === undefined ? {} : { limit: failure.rateLimit.limit }),
            ...(failure.rateLimit.remaining === undefined
              ? {}
              : { remaining: failure.rateLimit.remaining }),
            ...(failure.rateLimit.resetAt === undefined
              ? {}
              : { resetAt: failure.rateLimit.resetAt }),
            ...(failure.rateLimit.retryAfterSeconds === undefined
              ? {}
              : { retryAfterSeconds: failure.rateLimit.retryAfterSeconds }),
            ...(failure.rateLimit.source === undefined ? {} : { source: failure.rateLimit.source }),
          },
        }),
    // Where the quota actually lives. Distinct from the key page: a rate-limited user does not need
    // to re-read their key, they need the page that shows what they have spent.
    ...(providerDescriptor(context.provider)?.dashboardUrl === undefined
      ? {}
      : { dashboardUrl: providerDescriptor(context.provider)?.dashboardUrl }),
    provider: providerLabel(context.provider),
    model: context.model,
    // The whole walk, so a total failure is ONE card listing what was tried rather than a sequence
    // of errors the user has to reassemble.
    attempts: context.attempts === undefined ? [] : [...context.attempts],
  };
}

/** Everything an engineer needs to chase a provider failure, and nothing a user will ever see. */
export interface FailureDiagnostics {
  provider: string;
  model: string;
  /** HTTP status, when the failure had one. Absent for transport failures. */
  status?: number | undefined;
  /** The adapter's machine code — `HTTP_429`, `NETWORK`, `MODEL_empty`. */
  errorCode: string;
  /** Wall time from request start to failure, in ms. */
  latencyMs: number;
  /** The provider's correlation id, when it sent one. The single most useful field in a support ticket. */
  requestId?: string | undefined;
  retryable: boolean;
  /** The provider's own message. Logged in full here precisely because it is never shown. */
  detail?: string | undefined;
}

/**
 * Write the diagnostic half to the developer log.
 *
 * `console.error` rather than a debug level on purpose: this only fires when a run has already
 * failed, and a failure with no trace is the case that is impossible to support after the fact.
 * Never logs the API key, the prompt, or the file contents.
 */
export function logProviderFailure(
  failure: ProviderFailure,
  diagnostics: FailureDiagnostics,
): void {
  console.error('[ai] provider failure', {
    category: failure.category,
    layer: failure.layer,
    severity: severityOf(failure),
    provider: diagnostics.provider,
    model: diagnostics.model,
    status: diagnostics.status,
    errorCode: diagnostics.errorCode,
    latencyMs: diagnostics.latencyMs,
    requestId: diagnostics.requestId,
    retryable: diagnostics.retryable,
    providerMessage: diagnostics.detail,
  });
}

/**
 * A configuration failure Fixora detects itself, before any request is sent.
 *
 * A missing key never reaches the provider, so it has no status code to classify — but it is exactly
 * the failure the card is best at explaining, and leaving it as a bare sentence would leave the panel
 * without the one thing that fixes it. Classified as `configuration` because it unambiguously is.
 */
export function missingKeyFailure(model: string): AiFailure {
  return {
    category: 'invalid-api-key',
    layer: 'configuration',
    actions: ['open-settings'],
    provider: providerLabel('openrouter'),
    model,
    attempts: [],
  };
}

/** Fixora's own deadline expiring. Same shape as a provider 504 — from the user's seat, it is one. */
export function timeoutFailure(context: { provider: string; model: string }): AiFailure {
  return toWireFailure(describeProviderFailure({ providerCode: 'TIMEOUT' }), context);
}
