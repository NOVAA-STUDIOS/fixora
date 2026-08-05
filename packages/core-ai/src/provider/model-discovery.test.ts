import { describe, expect, it } from 'vitest';

import { allDescriptors, providerDescriptor } from './catalog.js';

/**
 * How each provider's model list is obtained, one case per provider.
 *
 * `discovery` is the contract the Settings panel and the listing handler both read, and it is easy
 * to get wrong in a way nothing notices: a provider marked `static` with an empty curated list
 * silently offers no models at all, which is exactly what Azure did. These assert the intent per
 * provider so a wrong mode is a failing test rather than an empty dropdown.
 *
 * The rule tying them together: a provider is either listable at runtime, or it ships a curated list.
 * Never neither — except Azure, whose exception is stated below and is about deployments not existing
 * as a vendor concept at all.
 */
describe('model discovery, per provider', () => {
  it('OpenRouter — a live catalogue with capability metadata', () => {
    expect(providerDescriptor('openrouter')?.discovery).toBe('catalogue');
  });

  it('OpenAI — a live id list from /v1/models', () => {
    expect(providerDescriptor('openai')?.discovery).toBe('id-list');
  });

  it('Anthropic — a live id list, with a curated fallback for the no-key case', () => {
    const descriptor = providerDescriptor('anthropic');
    expect(descriptor?.discovery).toBe('id-list');
    // Listing needs a key, so choosing a model before saving one must still offer something.
    expect(descriptor?.models?.length ?? 0).toBeGreaterThan(0);
  });

  it('Gemini — a live id list from /v1beta/models', () => {
    expect(providerDescriptor('gemini')?.discovery).toBe('id-list');
  });

  it('Groq — a live id list, OpenAI-compatible', () => {
    expect(providerDescriptor('groq')?.discovery).toBe('id-list');
  });

  it('Azure — static, and curated-empty ON PURPOSE', () => {
    const descriptor = providerDescriptor('azure-openai');
    expect(descriptor?.discovery).toBe('static');
    // Azure addresses DEPLOYMENTS the user named in their own resource. There is no vendor list to
    // curate, and shipping ids here would suggest names wrong for every subscriber.
    expect(descriptor?.models ?? []).toEqual([]);
  });

  it('Ollama — discovered from the local daemon, so it reflects what was actually pulled', () => {
    expect(providerDescriptor('ollama')?.discovery).toBe('local');
  });

  it('LM Studio — discovered from the local daemon', () => {
    expect(providerDescriptor('lmstudio')?.discovery).toBe('local');
  });

  it('every provider has a default model, so an empty field always resolves', () => {
    // The "empty field = descriptor default" contract depends on this for all eight.
    for (const descriptor of allDescriptors()) {
      expect(descriptor.defaultModel, descriptor.id).not.toBe('');
    }
  });

  it('a curated list never contains duplicates or blanks', () => {
    for (const descriptor of allDescriptors()) {
      const models = descriptor.models ?? [];
      expect(new Set(models).size, descriptor.id).toBe(models.length);
      expect(models.filter((m) => m.trim() === ''), descriptor.id).toEqual([]);
    }
  });
});
