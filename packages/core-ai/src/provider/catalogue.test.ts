import { describe, expect, it } from 'vitest';

import {
  CATALOGUE_ENDPOINT,
  PREFERRED_FREE_CODE_MODELS,
  fetchModelCatalogue,
  isModelAvailable,
  pickDefaultModel,
  toCatalogueModel,
  type CatalogueModel,
} from './catalogue.js';

/**
 * The catalogue exists because hardcoded ids expire: OpenRouter retires slugs and answers a retired
 * one with a bare 404, which is how every AI action in the beta broke at once. These tests pin the
 * two things that must hold — we never pick a model that is not in the catalogue, and we never
 * silently pick a *billable* one when the user asked for free.
 */

function model(over: Partial<CatalogueModel> & { id: string }): CatalogueModel {
  return {
    name: over.id,
    free: false,
    codeCapable: false,
    structuredOutput: false,
    contextLength: null,
    ...over,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('toCatalogueModel', () => {
  it('treats a :free suffix as free', () => {
    expect(toCatalogueModel({ id: 'vendor/thing:free' })?.free).toBe(true);
  });

  it('treats zero prompt AND completion pricing as free', () => {
    expect(toCatalogueModel({ id: 'a/b', pricing: { prompt: '0', completion: '0' } })?.free).toBe(
      true,
    );
  });

  it('fails closed on cost: a zero prompt with a paid completion is not free', () => {
    expect(
      toCatalogueModel({ id: 'a/b', pricing: { prompt: '0', completion: '0.002' } })?.free,
    ).toBe(false);
    // Unparseable pricing must not be mistaken for free — the user gets billed for our guess.
    expect(
      toCatalogueModel({ id: 'a/b', pricing: { prompt: 'unknown', completion: 'unknown' } })?.free,
    ).toBe(false);
    expect(toCatalogueModel({ id: 'a/b' })?.free).toBe(false);
  });

  it('detects code orientation from id, name or description', () => {
    expect(toCatalogueModel({ id: 'x/north-mini-code:free' })?.codeCapable).toBe(true);
    expect(toCatalogueModel({ id: 'x/y', name: 'Something Coder' })?.codeCapable).toBe(true);
    expect(
      toCatalogueModel({ id: 'x/y', description: 'optimized for agentic coding' })?.codeCapable,
    ).toBe(true);
    expect(toCatalogueModel({ id: 'x/y', description: 'a chat model' })?.codeCapable).toBe(false);
  });

  it('rejects an entry with no usable id', () => {
    expect(toCatalogueModel({})).toBeNull();
    expect(toCatalogueModel({ id: '' })).toBeNull();
  });
});

describe('pickDefaultModel', () => {
  it('prefers the first wish-list entry that actually exists', () => {
    const catalogue = [
      model({ id: 'other/thing:free', free: true, codeCapable: true }),
      // The second preference — the first is absent, which is the real situation today.
      model({ id: PREFERRED_FREE_CODE_MODELS[1] ?? '', free: true, codeCapable: true }),
    ];
    expect(pickDefaultModel(catalogue)).toBe(PREFERRED_FREE_CODE_MODELS[1]);
  });

  it('falls back to any free code model when no preference exists', () => {
    const catalogue = [
      model({ id: 'paid/coder', codeCapable: true }),
      model({ id: 'free/coder:free', free: true, codeCapable: true }),
      model({ id: 'free/chat:free', free: true }),
    ];
    expect(pickDefaultModel(catalogue)).toBe('free/coder:free');
  });

  it('falls back to any free model when no free code model exists', () => {
    const catalogue = [
      model({ id: 'paid/coder', codeCapable: true }),
      model({ id: 'f/c:free', free: true }),
    ];
    expect(pickDefaultModel(catalogue)).toBe('f/c:free');
  });

  it('returns null rather than selecting a paid model on the user’s behalf', () => {
    // The whole point of the beta default is that nobody has to buy credits to try it. Silently
    // picking a billable model here would charge someone for our fallback.
    expect(pickDefaultModel([model({ id: 'paid/a' }), model({ id: 'paid/b' })])).toBeNull();
    expect(pickDefaultModel([])).toBeNull();
  });
});

describe('fetchModelCatalogue', () => {
  it('requests the documented public endpoint with no Authorization header', async () => {
    let seenUrl = '';
    let seenInit: RequestInit | undefined;
    await fetchModelCatalogue((url, init) => {
      seenUrl = url;
      seenInit = init;
      return Promise.resolve(jsonResponse({ data: [{ id: 'a/b' }] }));
    });
    expect(seenUrl).toBe(CATALOGUE_ENDPOINT);
    // BYOK: listing models must not involve the user's key.
    expect(JSON.stringify(seenInit?.headers ?? {})).not.toContain('Authorization');
  });

  it('throws on a non-OK response instead of reporting an empty catalogue', async () => {
    // An empty list would read as "no models exist" and migrate a perfectly good configuration away.
    await expect(fetchModelCatalogue(() => Promise.resolve(jsonResponse({}, 500)))).rejects.toThrow(
      /500/,
    );
  });

  it('throws on a malformed or empty payload', async () => {
    await expect(
      fetchModelCatalogue(() => Promise.resolve(jsonResponse({ nope: true }))),
    ).rejects.toThrow(/data array/);
    await expect(
      fetchModelCatalogue(() => Promise.resolve(jsonResponse({ data: [] }))),
    ).rejects.toThrow(/empty/);
  });

  it('skips unusable entries but keeps the rest', async () => {
    const catalogue = await fetchModelCatalogue(() =>
      Promise.resolve(jsonResponse({ data: [{ id: 'good/one' }, { name: 'no id' }, null] })),
    );
    expect(catalogue.map((m) => m.id)).toEqual(['good/one']);
  });
});

describe('isModelAvailable', () => {
  it('is an exact match, not a prefix one', () => {
    const catalogue = [model({ id: 'vendor/thing:free' })];
    expect(isModelAvailable(catalogue, 'vendor/thing:free')).toBe(true);
    expect(isModelAvailable(catalogue, 'vendor/thing')).toBe(false);
  });
});

/**
 * Capability detection, measured from provider metadata.
 *
 * The bug these guard against: Fixora's default model list contained three models, and on
 * 2026-07-20 the live catalogue reported that ALL THREE were incapable of structured output (one
 * had been retired entirely). Fixora asked every one of them for schema-constrained JSON, none
 * could honour it, and every repair failed. Nothing in the code checked — capability was assumed.
 */
describe('structured-output capability', () => {
  const raw = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    id: 'x/y:free',
    name: 'Y',
    pricing: { prompt: '0', completion: '0' },
    supported_parameters: ['structured_outputs', 'response_format'],
    context_length: 128000,
    ...over,
  });

  it('reads structured output from supported_parameters', () => {
    expect(toCatalogueModel(raw())?.structuredOutput).toBe(true);
  });

  it('fails CLOSED when the provider does not list the capability', () => {
    expect(toCatalogueModel(raw({ supported_parameters: ['temperature'] }))?.structuredOutput).toBe(
      false,
    );
  });

  it('fails CLOSED when supported_parameters is absent or malformed', () => {
    // "We do not know" must never be read as "yes" — that assumption is the whole bug.
    expect(toCatalogueModel(raw({ supported_parameters: undefined }))?.structuredOutput).toBe(
      false,
    );
    expect(toCatalogueModel(raw({ supported_parameters: 'nope' }))?.structuredOutput).toBe(false);
    expect(toCatalogueModel(raw({ supported_parameters: null }))?.structuredOutput).toBe(false);
  });

  it('records the context window, and null when unstated', () => {
    expect(toCatalogueModel(raw())?.contextLength).toBe(128000);
    expect(toCatalogueModel(raw({ context_length: undefined }))?.contextLength).toBeNull();
  });

  it('prefers a capable general model over an incapable code model', () => {
    // The exact inversion that shipped: a "code" model that cannot return parseable output is
    // useless for repair, which is the product.
    const chosen = pickDefaultModel([
      toCatalogueModel(raw({ id: 'a/code:free', name: 'Coder', supported_parameters: [] }))!,
      toCatalogueModel(raw({ id: 'b/general:free', name: 'General' }))!,
    ]);
    expect(chosen).toBe('b/general:free');
  });

  it('still returns something when nothing free is capable, rather than refusing', () => {
    // Degraded, not dead: the recovery path gives an incapable model a real chance of working.
    const chosen = pickDefaultModel([
      toCatalogueModel(raw({ id: 'a/code:free', name: 'Coder', supported_parameters: [] }))!,
    ]);
    expect(chosen).toBe('a/code:free');
  });
});
