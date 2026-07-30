import { describe, expect, it } from 'vitest';

import {
  buildReAskMessage,
  describeModelOutputFailure,
  describeProviderFailure,
  describeSchemaFailureForUser,
} from './failure.js';

/**
 * P2.2.1. Users were shown raw transport strings — "429 Too Many Requests — Rate limit exceeded:
 * free-models-per-day. Add 10 credits to unlock 1000 free model requests per day (HTTP_429)". These
 * pin that every failure is classified to a layer and rendered as a sentence someone can act on,
 * and that the provider's own code survives for logs without becoming the headline.
 */

describe('describeProviderFailure', () => {
  it('429 → the exact quota wording, retryable', () => {
    const f = describeProviderFailure({ providerCode: 'HTTP_429', detail: 'Rate limit exceeded' });
    expect(f.kind).toBe('quota');
    expect(f.message).toBe(
      'Your OpenRouter quota has been exhausted. Please wait until the quota resets or select another model.',
    );
    expect(f.retryable).toBe(true);
    expect(f.message).not.toMatch(/429|HTTP|Too Many Requests/); // no raw transport in the headline
    expect(f.providerCode).toBe('HTTP_429'); // still available for logs
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

  it('carries the provider’s own words for an unrecognised code rather than inventing a cause', () => {
    const f = describeProviderFailure({ providerCode: 'WEIRD', detail: 'model is cold' });
    expect(f.message).toContain('model is cold');
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

  it('a schema mismatch names the reason and keeps the detail', () => {
    const f = describeModelOutputFailure('schema-mismatch', 'editedCode: too small');
    expect(f.message).toContain('schema-mismatch');
    expect(f.message).toContain('editedCode: too small');
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
