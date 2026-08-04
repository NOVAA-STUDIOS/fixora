/**
 * Provider failure classification (P2.2.1; extended by the Provider Error UX sprint).
 *
 * The adapter reports the provider's own words plus a machine code (`HTTP_429`, `NETWORK`, …). That
 * is exactly right for logs and exactly wrong for a panel: users were shown raw transport strings like
 * "429 Too Many Requests — Rate limit exceeded: free-models-per-day. Add 10 credits to unlock 1000
 * free model requests per day (HTTP_429)". This turns that into (a) which layer actually failed and
 * (b) a sentence the user can act on — without inventing a cause the provider did not state.
 *
 * Pure and shared: both the repair path and Proceed classify failures the same way, so the two never
 * disagree about what a 429 means.
 *
 * Two invariants hold for every value this module returns, and both are tested exhaustively over the
 * category set rather than case by case:
 *
 *  - **`actions` is never empty.** A failure with no way forward is a dead end, and the panel has no
 *    other source of recovery options.
 *  - **`layer` is never `engine`.** Nothing reachable from a provider response is Fixora's fault, and
 *    saying otherwise sends users to file bugs against the wrong system.
 */

import {
  type FailureCategory,
  type FailureLayer,
  type FailureSeverity,
  type RecoveryAction,
} from './failure-model.js';

export * from './failure-model.js';

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
  /** Coarse grouping, retained because existing call sites switch on it. */
  readonly kind: FailureKind;
  /** The actionable classification. Prefer this over `kind` in anything user-facing. */
  readonly category: FailureCategory;
  /** Whose problem this is. Never `engine` from this module. */
  readonly layer: FailureLayer;
  /** One sentence, addressed to the user, that says what to do next. Never a raw HTTP string. */
  readonly message: string;
  /** Whether retrying the same request could plausibly succeed (drives a Retry affordance). */
  readonly retryable: boolean;
  /** Ordered recovery options, most useful first. Guaranteed non-empty. */
  readonly actions: readonly RecoveryAction[];
  /** The provider's own code, preserved for logs and bug reports — not shown as the headline. */
  readonly providerCode: string;
}

/**
 * Severity is derived, not chosen per case, so the styling rule stays a rule.
 *
 * A configuration problem is always danger: it will not clear on its own and the user must decide
 * something. Everything else is a warning while a retry could still work, and danger once it cannot.
 */
export function severityOf(failure: {
  layer: FailureLayer;
  retryable: boolean;
}): FailureSeverity {
  if (failure.layer === 'configuration') return 'danger';
  return failure.retryable ? 'warning' : 'danger';
}

/** Assemble a failure, filling in the fields that are always the same shape. */
function failure(input: {
  kind: FailureKind;
  category: FailureCategory;
  layer: Exclude<FailureLayer, 'engine'>;
  message: string;
  retryable: boolean;
  actions: readonly [RecoveryAction, ...RecoveryAction[]];
  providerCode: string;
}): ProviderFailure {
  return input;
}

/**
 * Does the provider's own message say this 429 is an exhausted allowance rather than a burst limit?
 *
 * OpenRouter returns 429 for both, and they have opposite answers — "wait a moment" versus "add
 * credits or switch models". We only claim quota exhaustion when the provider's text says so; a bare
 * 429 with no explanation stays `rate-limited`, which is the reading that costs the user nothing if
 * we are wrong. Deliberately not a guess dressed up as a diagnosis.
 */
function looksLikeExhaustedQuota(detail: string): boolean {
  const text = detail.toLowerCase();
  return (
    text.includes('per-day') ||
    text.includes('per day') ||
    text.includes('daily') ||
    text.includes('quota') ||
    text.includes('credit') ||
    text.includes('exhausted') ||
    text.includes('add 10 credits')
  );
}

/** A 400 that is really "your request was too big". Providers word this several ways. */
function looksLikeContextOverflow(detail: string): boolean {
  const text = detail.toLowerCase();
  return (
    text.includes('context length') ||
    text.includes('context_length') ||
    text.includes('maximum context') ||
    text.includes('too many tokens') ||
    text.includes('reduce the length')
  );
}

/**
 * Classify a provider error event. `providerCode` is the adapter's code; `detail` is the provider's
 * own message, used only to disambiguate cases the status code genuinely cannot separate (429
 * rate-limit versus exhausted quota, 400 versus context overflow). It is never echoed to the user.
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
    // Same status, two different problems. See `looksLikeExhaustedQuota`.
    return looksLikeExhaustedQuota(detail)
      ? failure({
          kind: 'quota',
          category: 'quota-exceeded',
          layer: 'provider',
          message:
            'Your provider allowance for this model is used up for now. It will reset on the provider’s schedule — until then, switch to another configured model or add credits.',
          retryable: false,
          actions: ['change-model', 'check-credits', 'retry-later', 'open-settings'],
          providerCode: code,
        })
      : failure({
          kind: 'quota',
          category: 'rate-limited',
          layer: 'provider',
          message:
            'The provider is limiting how fast requests can be sent. Nothing is wrong with your setup — wait a few seconds and try again.',
          retryable: true,
          actions: ['retry', 'change-model'],
          providerCode: code,
        });
  }
  if (status === '402') {
    return failure({
      kind: 'quota',
      category: 'quota-exceeded',
      layer: 'configuration',
      message:
        'Your provider account is out of credits. Add credits, or switch to a free model in Settings → AI.',
      retryable: false,
      actions: ['check-credits', 'change-model', 'open-settings'],
      providerCode: code,
    });
  }
  if (status === '401') {
    return failure({
      kind: 'auth',
      category: 'invalid-api-key',
      layer: 'configuration',
      message:
        'The provider did not accept your API key. Check the key in Settings → AI — it may be mistyped, revoked, or from a different provider.',
      retryable: false,
      actions: ['open-settings'],
      providerCode: code,
    });
  }
  if (status === '403') {
    // 403 is a valid key without permission — a different fix from 401, and worth separating.
    return failure({
      kind: 'auth',
      category: 'auth-failed',
      layer: 'configuration',
      message:
        'Your API key was recognised but is not allowed to use this model. Pick a model your account has access to, or check the key’s permissions with your provider.',
      retryable: false,
      actions: ['change-model', 'open-settings'],
      providerCode: code,
    });
  }
  if (status === '404') {
    return failure({
      kind: 'model',
      category: 'model-unavailable',
      layer: 'configuration',
      message:
        'The selected model is no longer offered by the provider. Model ids are retired over time — pick another model in Settings → AI.',
      retryable: false,
      actions: ['change-model', 'open-settings'],
      providerCode: code,
    });
  }
  if (status === '413' || (status === '400' && looksLikeContextOverflow(detail))) {
    return failure({
      kind: 'model',
      category: 'context-too-large',
      layer: 'provider',
      message:
        'This request was larger than the selected model can accept. Repairing a smaller scope, or choosing a model with a larger context window, will fit.',
      retryable: false,
      actions: ['change-model', 'open-settings'],
      providerCode: code,
    });
  }
  if (status === '408' || status === '504' || code === 'TIMEOUT') {
    return failure({
      kind: 'provider',
      category: 'timeout',
      layer: 'provider',
      message:
        'The provider did not answer in time. This is usually load on their side — nothing was changed, and trying again often works.',
      retryable: true,
      actions: ['retry', 'change-model'],
      providerCode: code,
    });
  }
  if (status !== undefined && Number(status) >= 500) {
    return failure({
      kind: 'provider',
      category: 'provider-unavailable',
      layer: 'provider',
      message:
        'The provider is having trouble right now. This is on their side, not Fixora’s — try again shortly, or switch to another configured model.',
      retryable: true,
      actions: ['retry', 'change-model', 'retry-later'],
      providerCode: code,
    });
  }
  if (code === 'NETWORK' || code === 'NO_BODY' || code === 'STREAM') {
    return failure({
      kind: 'network',
      category: 'network-offline',
      layer: 'provider',
      message:
        'Fixora could not reach the provider. Check your internet connection or VPN and try again — nothing was changed.',
      retryable: true,
      actions: ['check-connection', 'retry'],
      providerCode: code,
    });
  }

  // Anything else. Deliberately does NOT quote the provider's raw text: it is the one input we have
  // no classification for, which makes it exactly the text most likely to be a transport dump.
  return failure({
    kind: 'provider',
    category: 'unknown-provider-error',
    layer: 'provider',
    message:
      'The provider refused the request and did not say why in a way Fixora recognises. The full response is in the developer log.',
    retryable: input.retryable ?? false,
    actions: input.retryable === true ? ['retry', 'change-model'] : ['change-model', 'open-settings'],
    providerCode: code,
  });
}

/**
 * A run that exceeded Fixora's own budget and was aborted — nobody answered at all.
 *
 * Classified here rather than in the service so the card treats a Fixora-side timeout and a provider
 * 504 identically, which from the user's seat they are. Attributed to the provider, because a stalled
 * stream is the provider not responding; the deadline is ours, the silence is theirs.
 */
export function describeTimeoutFailure(): ProviderFailure {
  return describeProviderFailure({ providerCode: 'TIMEOUT' });
}

/**
 * The one re-ask message, after a parse failure — shared so Repair and Proceed can never drift
 * (bug-fix sprint, Phase 1: they were two hand-duplicated copies of the same generic sentence,
 * regardless of WHY parsing failed). Reason-specific where that actually raises the odds of the
 * retry succeeding: a `truncated` response needs "be shorter", not "remove surrounding text" (which
 * it likely didn't have); a `schema-mismatch` already carries the exact offending field in `detail`
 * — echoing it back is strictly more actionable than a generic reminder. Every other reason (empty,
 * no-json-object, malformed-json) keeps the original, still-correct generic instruction.
 */
export function buildReAskMessage(failure: { reason: string; detail: string }): string {
  if (failure.reason === 'truncated') {
    return (
      'Your previous response was cut off before it finished — it looked like valid JSON but was ' +
      'incomplete. Return the SAME JSON object again, complete this time, and nothing else. Keep ' +
      'any free-text fields (rationale, summary) brief so the whole object fits.'
    );
  }
  if (failure.reason === 'schema-mismatch' && failure.detail.trim() !== '') {
    return (
      `Your previous response was valid JSON but did not match the required schema: ${failure.detail.trim()}. ` +
      'Return ONLY a corrected JSON object, with no surrounding text.'
    );
  }
  return (
    'Your previous response was not valid JSON matching the required schema. ' +
    'Return ONLY the JSON object, with no surrounding text.'
  );
}

/**
 * The correction sent back to the model when a patch PARSED cleanly but failed verification.
 *
 * Distinct from {@link buildReAskMessage}, which handles a malformed *response*. Here the response
 * was fine and the *patch* was wrong: it did not parse as code, it broke something that worked, or
 * it left the original problem in place. Each of those needs a different instruction, and naming the
 * specific evidence — the parser's line, the exact new findings, the unresolved rule — is what makes
 * the retry more than a re-roll.
 *
 * The verifier's verdict is never softened by this. It still gates Apply on every attempt; this only
 * gives the model the diagnostic it needs to do better on the next one.
 */
export function buildVerificationReAskMessage(report: {
  verdict: string;
  syntaxOk: boolean;
  syntaxError?: { line: number; column: number; text: string } | undefined;
  newFindings?: readonly { source: string; ruleId: string; line: number; message: string }[] | undefined;
  note?: string | undefined;
}): string {
  const tail =
    ' Return ONLY the corrected JSON object, in the same shape as before, with no surrounding text.';

  if (!report.syntaxOk) {
    const where =
      report.syntaxError === undefined
        ? ''
        : ` The parser failed at line ${String(report.syntaxError.line)}, column ${String(
            report.syntaxError.column,
          )}, near: ${report.syntaxError.text.slice(0, 120)}.`;
    return (
      'Your previous fix was rejected because the patched file no longer parses as valid code.' +
      `${where} Re-read the original snippet, keep its syntax intact — matching brackets, quotes and ` +
      'statement terminators — and fix the reported problem without breaking the structure.' +
      tail
    );
  }

  const introduced = report.newFindings ?? [];
  if (report.verdict === 'regression' && introduced.length > 0) {
    const list = introduced
      .slice(0, 5)
      .map((f) => `  - line ${String(f.line)} — ${f.ruleId}: ${f.message}`)
      .join('\n');
    const more =
      introduced.length > 5 ? `\n  …and ${String(introduced.length - 5)} more.` : '';
    return (
      'Your previous fix was rejected: it resolved the original problem but INTRODUCED new ones that ' +
      `the file did not have before:\n${list}${more}\n` +
      'Fix the original problem without causing these. If your approach cannot avoid them, choose a ' +
      'narrower change that leaves the surrounding behaviour untouched.' +
      tail
    );
  }
  if (report.verdict === 'regression') {
    return (
      'Your previous fix was rejected because it introduced new problems the file did not have ' +
      `before.${report.note === undefined ? '' : ` ${report.note}`} Make a narrower change that fixes ` +
      'only the reported problem and leaves the surrounding behaviour untouched.' +
      tail
    );
  }

  // `unresolved`: nothing broke, but the finding is still reported against the patched file.
  return (
    'Your previous fix was rejected because the original problem is STILL reported after applying ' +
    `it — the change did not take effect.${report.note === undefined ? '' : ` ${report.note}`} ` +
    'Re-read the snippet and address the actual cause of the reported problem rather than an ' +
    'adjacent detail.' +
    tail
  );
}

/**
 * What the USER is told when the model's answer never matched the required shape, after the retry.
 *
 * Deliberately says nothing about schemas, field paths, or JSON. Those are real and useful — to a
 * maintainer, in a log — but to the person trying to fix their code they are noise that reads like the
 * tool broke. The old message pasted the raw zod diagnostic ("The response was valid JSON but did not
 * match the required shape — repairedCode: Required") plus an absolute path to a debug dump straight
 * into the panel, which leaked implementation detail and filesystem paths at the same time.
 *
 * What replaces it names the one thing the user can act on: the model, not their code, is the problem,
 * and a different model is the fix.
 */
export function describeSchemaFailureForUser(profile: string): string {
  return (
    `The model could not produce a usable ${profile} for this file, even after Fixora asked it again. ` +
    'This is a limitation of the selected model rather than a problem with your code — try again, or ' +
    'choose a stronger model in Settings → AI.'
  );
}

/** The model replied, but not with usable output. Distinct from the provider failing to reply. */
export function describeModelOutputFailure(reason: string, detail = ''): ProviderFailure {
  const trimmed = detail.trim();
  const message =
    reason === 'empty'
      ? 'The model returned an empty response. This usually means the model is overloaded or too small for the task — try again, or pick a stronger model in Settings → AI.'
      : `The model's answer did not match the format Fixora requires${
          trimmed === '' ? '' : ` (${trimmed})`
        }. This is a limitation of the selected model, not of your code — try again, or pick a stronger model.`;
  return {
    kind: 'model-output',
    category: 'invalid-response',
    // The provider answered; the model is the provider's product. Not a configuration mistake, and
    // emphatically not the repair engine — this failure happens before any patch exists.
    layer: 'provider',
    message,
    retryable: true,
    actions: ['retry', 'change-model'],
    providerCode: `MODEL_${reason}`,
  };
}
