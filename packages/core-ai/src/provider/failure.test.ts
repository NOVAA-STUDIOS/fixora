import { describe, expect, it } from 'vitest';

import { describeModelOutputFailure, describeProviderFailure } from './failure.js';

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
