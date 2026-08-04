import { describe, expect, it } from 'vitest';

import {
  buildReAskMessage,
  buildVerificationReAskMessage,
  describeModelOutputFailure,
  describeProviderFailure,
  describeSchemaFailureForUser,
  describeTimeoutFailure,
  severityOf,
  type FailureCategory,
  type ProviderFailure,
} from './failure.js';

/**
 * P2.2.1. Users were shown raw transport strings — "429 Too Many Requests — Rate limit exceeded:
 * free-models-per-day. Add 10 credits to unlock 1000 free model requests per day (HTTP_429)". These
 * pin that every failure is classified to a layer and rendered as a sentence someone can act on,
 * and that the provider's own code survives for logs without becoming the headline.
 */

describe('describeProviderFailure', () => {
  /**
   * A bare 429 is a BURST limit until the provider says otherwise.
   *
   * We used to report every 429 as "your quota has been exhausted", which sent users to top up an
   * account that was merely being throttled for a few seconds. The two share a status code and have
   * opposite answers, so the split is driven by the provider's own words and defaults to the reading
   * that costs the user nothing if we are wrong.
   */
  it('a bare 429 is rate limiting — retryable, and never claims the quota is gone', () => {
    const f = describeProviderFailure({ providerCode: 'HTTP_429', detail: 'Rate limit exceeded' });
    expect(f.category).toBe('rate-limited');
    expect(f.retryable).toBe(true);
    expect(f.actions).toContain('retry');
    expect(f.message.toLowerCase()).not.toContain('quota');
    expect(f.message).not.toMatch(/429|HTTP|Too Many Requests/); // no raw transport in the headline
    expect(f.providerCode).toBe('HTTP_429'); // still available for logs
  });

  it('a 429 the provider explains as an exhausted daily allowance is quota, not throttling', () => {
    const f = describeProviderFailure({
      providerCode: 'HTTP_429',
      detail: 'Rate limit exceeded: free-models-per-day. Add 10 credits to unlock 1000 requests',
    });
    expect(f.category).toBe('quota-exceeded');
    // Not retryable: hammering Retry cannot bring the allowance back.
    expect(f.retryable).toBe(false);
    expect(f.actions).toContain('check-credits');
    expect(f.actions).not.toContain('retry');
  });

  it('separates auth, credit, model and provider-side failures', () => {
    expect(describeProviderFailure({ providerCode: 'HTTP_401' }).kind).toBe('auth');
    expect(describeProviderFailure({ providerCode: 'HTTP_403' }).kind).toBe('auth');
    expect(describeProviderFailure({ providerCode: 'HTTP_402' }).kind).toBe('quota');
    expect(describeProviderFailure({ providerCode: 'HTTP_404' }).kind).toBe('model');
    expect(describeProviderFailure({ providerCode: 'HTTP_503' }).kind).toBe('provider');
  });

  it('marks only the plausibly-recoverable failures retryable', () => {
    expect(describeProviderFailure({ providerCode: 'HTTP_429' }).retryable).toBe(true);
    expect(describeProviderFailure({ providerCode: 'HTTP_503' }).retryable).toBe(true);
    expect(describeProviderFailure({ providerCode: 'NETWORK' }).retryable).toBe(true);
    expect(describeProviderFailure({ providerCode: 'HTTP_401' }).retryable).toBe(false);
    expect(describeProviderFailure({ providerCode: 'HTTP_404' }).retryable).toBe(false);
  });

  it('treats transport failures as network, not as the model misbehaving', () => {
    for (const code of ['NETWORK', 'NO_BODY', 'STREAM']) {
      expect(describeProviderFailure({ providerCode: code }).kind).toBe('network');
    }
  });

  /**
   * Reversed deliberately by the Provider Error UX sprint. Quoting the provider's own words was the
   * safe choice while the alternative was inventing a cause — but the unrecognised branch is by
   * definition the text we have no classification for, which makes it the string most likely to be a
   * raw transport dump. It goes to the developer log, where it is useful, and not to the panel.
   */
  it('an unrecognised code never quotes the provider’s raw text at the user', () => {
    const f = describeProviderFailure({ providerCode: 'WEIRD', detail: '500 tcp reset by peer' });
    expect(f.category).toBe('unknown-provider-error');
    expect(f.message).not.toContain('tcp reset by peer');
    expect(f.message).toContain('developer log');
    expect(f.providerCode).toBe('WEIRD'); // preserved for that log
  });

  it('separates the two 4xx auth failures — a bad key and a key without access differ', () => {
    expect(describeProviderFailure({ providerCode: 'HTTP_401' }).category).toBe('invalid-api-key');
    expect(describeProviderFailure({ providerCode: 'HTTP_403' }).category).toBe('auth-failed');
    // A wrong key cannot be fixed by picking a different model; a forbidden one often can.
    expect(describeProviderFailure({ providerCode: 'HTTP_403' }).actions).toContain('change-model');
  });

  it('classifies context overflow only when the provider’s own message says so', () => {
    expect(describeProviderFailure({ providerCode: 'HTTP_413' }).category).toBe('context-too-large');
    expect(
      describeProviderFailure({
        providerCode: 'HTTP_400',
        detail: 'This model maximum context length is 8192 tokens',
      }).category,
    ).toBe('context-too-large');
    // A plain 400 is not assumed to be an oversized request.
    expect(describeProviderFailure({ providerCode: 'HTTP_400' }).category).toBe(
      'unknown-provider-error',
    );
  });

  it('treats a stalled provider as a timeout, whoever clock ran out', () => {
    for (const code of ['HTTP_408', 'HTTP_504', 'TIMEOUT']) {
      const f = describeProviderFailure({ providerCode: code });
      expect(f.category, code).toBe('timeout');
      expect(f.retryable, code).toBe(true);
    }
    expect(describeTimeoutFailure().category).toBe('timeout');
  });
});

describe('describeModelOutputFailure', () => {
  it('an empty answer is a model-output failure, retryable, and says what to do', () => {
    const f = describeModelOutputFailure('empty');
    expect(f.kind).toBe('model-output');
    expect(f.retryable).toBe(true);
    expect(f.message).toMatch(/empty response/);
    expect(f.message).toMatch(/stronger model/);
  });

  it('is attributed to the model, never to the repair engine or the user code', () => {
    const f = describeModelOutputFailure('schema-mismatch', 'editedCode: too small');
    expect(f.category).toBe('invalid-response');
    expect(f.layer).toBe('provider');
    expect(f.message).toMatch(/limitation of the selected model/);
    expect(f.message).toMatch(/not of your code/);
  });
});

/**
 * Bug-fix sprint, Phase 1: Repair and Proceed used to each hand-write their own re-ask message,
 * always the same generic sentence regardless of WHY the first attempt failed — even when the
 * computed failure reason/detail (already known at that point) could make the retry more likely to
 * succeed. `buildReAskMessage` is now the ONE place this wording lives, shared by both pipelines.
 */
describe('buildReAskMessage', () => {
  it('a truncated response is asked to be complete and brief, not "remove surrounding text"', () => {
    const message = buildReAskMessage({ reason: 'truncated', detail: '' });
    expect(message).toMatch(/cut off|incomplete/i);
    expect(message).toMatch(/brief|shorter|fit/i);
    expect(message).not.toMatch(/surrounding text/);
  });

  it('a schema mismatch echoes the specific offending field back to the model', () => {
    const message = buildReAskMessage({
      reason: 'schema-mismatch',
      detail: 'confidence: Required',
    });
    expect(message).toContain('confidence: Required');
  });

  it('a schema mismatch with no detail falls back to the generic instruction', () => {
    const message = buildReAskMessage({ reason: 'schema-mismatch', detail: '' });
    expect(message).toBe(
      'Your previous response was not valid JSON matching the required schema. ' +
        'Return ONLY the JSON object, with no surrounding text.',
    );
  });

  it('every other reason (empty, no-json-object, malformed-json, unknown) uses the generic instruction', () => {
    for (const reason of ['empty', 'no-json-object', 'malformed-json', 'unknown']) {
      const message = buildReAskMessage({ reason, detail: 'irrelevant' });
      expect(message).toBe(
        'Your previous response was not valid JSON matching the required schema. ' +
          'Return ONLY the JSON object, with no surrounding text.',
      );
    }
  });
});

/**
 * ISSUE 3 regression: the user was shown the raw zod diagnostic — "The response was valid JSON but did
 * not match the required shape — repairedCode: Required" — plus an ABSOLUTE path to a debug dump. Two
 * leaks at once: internal schema vocabulary, and a filesystem path this codebase treats as user data
 * (Security §9). The field-level detail was simultaneously NOT being logged, so the one audience it
 * helps never saw it.
 */
describe('describeSchemaFailureForUser', () => {
  it('never leaks schema vocabulary, field paths, or JSON internals', () => {
    const message = describeSchemaFailureForUser('repair');
    for (const forbidden of [
      'schema',
      'JSON',
      'shape',
      'required',
      'zod',
      'parse',
      'undefined',
      'repairedCode',
    ]) {
      expect(message.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });

  it('never contains a filesystem path', () => {
    const message = describeSchemaFailureForUser('repair');
    expect(message).not.toMatch(/[A-Za-z]:\\/); // Windows drive, e.g. C:\Users\…
    expect(message).not.toMatch(/\/(?:home|tmp|var|Users)\//); // POSIX
    expect(message).not.toContain('.json');
  });

  it('names the operation and points at the actionable fix — the model, not the user code', () => {
    const message = describeSchemaFailureForUser('repair');
    expect(message).toContain('repair');
    expect(message).toMatch(/stronger model|Settings/);
    expect(message).toMatch(/rather than a problem with your code/i);
  });

  it('is not one of the forbidden generic strings', () => {
    const message = describeSchemaFailureForUser('repair').toLowerCase();
    expect(message).not.toContain('internal error');
    expect(message).not.toContain('unknown error');
    expect(message).not.toContain('something went wrong');
  });
});

/**
 * The two promises the status card depends on, checked exhaustively over the category set rather than
 * case by case. Case-by-case tests pass while a NEW category slips through with no recovery action or
 * with the blame pointed at Fixora - which is precisely the regression worth preventing.
 */
describe('failure invariants - hold for every category', () => {
  const ALL: { category: FailureCategory; failure: ProviderFailure }[] = [
    'HTTP_429',
    'HTTP_402',
    'HTTP_401',
    'HTTP_403',
    'HTTP_404',
    'HTTP_413',
    'HTTP_408',
    'HTTP_500',
    'HTTP_503',
    'NETWORK',
    'NO_BODY',
    'STREAM',
    'TIMEOUT',
    'WEIRD',
  ]
    .map((providerCode) => describeProviderFailure({ providerCode }))
    .concat(
      describeProviderFailure({ providerCode: 'HTTP_429', detail: 'quota exhausted' }),
      describeModelOutputFailure('empty'),
      describeModelOutputFailure('schema-mismatch', 'x'),
    )
    .map((failure) => ({ category: failure.category, failure }));

  it('covers all eleven categories', () => {
    const covered = [...new Set(ALL.map((f) => f.category))].sort();
    expect(covered).toEqual(
      [
        'auth-failed',
        'context-too-large',
        'invalid-api-key',
        'invalid-response',
        'model-unavailable',
        'network-offline',
        'provider-unavailable',
        'quota-exceeded',
        'rate-limited',
        'timeout',
        'unknown-provider-error',
      ].sort(),
    );
  });

  it('every failure offers at least one recovery action', () => {
    for (const { category, failure } of ALL) {
      expect(failure.actions.length, category).toBeGreaterThan(0);
    }
  });

  it('never blames the repair engine for a provider problem', () => {
    for (const { category, failure } of ALL) {
      expect(failure.layer, category).not.toBe('engine');
    }
  });

  it('never leaks raw transport strings into the user-facing message', () => {
    for (const { category, failure } of ALL) {
      expect(failure.message, category).not.toMatch(/HTTP[_ ]?\d{3}|\bstack\b/);
      expect(failure.message.length, category).toBeGreaterThan(20);
    }
  });

  it('only offers Retry where a retry could actually succeed', () => {
    for (const { category, failure } of ALL) {
      if (failure.actions.includes('retry')) expect(failure.retryable, category).toBe(true);
    }
  });

  it('styles configuration failures as danger and recoverable ones as warning', () => {
    expect(severityOf(describeProviderFailure({ providerCode: 'HTTP_401' }))).toBe('danger');
    expect(severityOf(describeProviderFailure({ providerCode: 'HTTP_402' }))).toBe('danger');
    expect(severityOf(describeProviderFailure({ providerCode: 'HTTP_503' }))).toBe('warning');
    expect(severityOf(describeProviderFailure({ providerCode: 'NETWORK' }))).toBe('warning');
  });
});

/**
 * Verification retry (feature): a patch that PARSED but failed its gates is re-asked with the
 * verifier's own diagnostic quoted back. The correction must name the specific evidence — the
 * parser's line, the exact new findings, the unresolved original — because a generic "try again"
 * is a re-roll, not a correction.
 */
describe('buildVerificationReAskMessage', () => {
  it('a syntax failure names where the parser stopped', () => {
    const msg = buildVerificationReAskMessage({
      verdict: 'regression',
      syntaxOk: false,
      syntaxError: { line: 42, column: 7, text: 'const x = {' },
    });
    expect(msg).toMatch(/no longer parses/i);
    expect(msg).toContain('42');
    expect(msg).toContain('const x = {');
    expect(msg).toMatch(/only the corrected json/i);
  });

  it('a regression lists the problems the patch introduced', () => {
    const msg = buildVerificationReAskMessage({
      verdict: 'regression',
      syntaxOk: true,
      newFindings: [
        { source: 'tsc', ruleId: 'TS2322', line: 10, message: 'Type mismatch.' },
        { source: 'eslint', ruleId: 'no-undef', line: 12, message: "'y' is not defined." },
      ],
    });
    expect(msg).toMatch(/INTRODUCED new ones/i);
    expect(msg).toContain('TS2322');
    expect(msg).toContain('no-undef');
    expect(msg).toContain('line 10');
  });

  it('caps the listed findings so a broken patch cannot flood the prompt', () => {
    const many = Array.from({ length: 9 }, (_, i) => ({
      source: 'tsc', ruleId: 'TS100' + String(i), line: i, message: 'boom',
    }));
    const msg = buildVerificationReAskMessage({ verdict: 'regression', syntaxOk: true, newFindings: many });
    expect(msg).toContain('and 4 more');
    expect(msg).not.toContain('TS1008');
  });

  it('an unresolved verdict says the fix did not take, not that it broke something', () => {
    const msg = buildVerificationReAskMessage({
      verdict: 'unresolved',
      syntaxOk: true,
      note: 'The finding is still reported at line 3.',
    });
    expect(msg).toMatch(/STILL reported/i);
    expect(msg).toContain('still reported at line 3');
    expect(msg).not.toMatch(/introduced/i);
  });

  it('a regression with no recorded findings still gives an actionable instruction', () => {
    const msg = buildVerificationReAskMessage({ verdict: 'regression', syntaxOk: true });
    expect(msg).toMatch(/narrower change/i);
    expect(msg.length).toBeGreaterThan(60);
  });
});
