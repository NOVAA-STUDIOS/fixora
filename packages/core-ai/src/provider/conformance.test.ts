import { describe, expect, it } from 'vitest';

import { resolveCapabilities, supportsCodeRepair, supportsProfile } from './capability.js';
import { allDescriptors, allProviders, providerDescriptor } from './catalog.js';

/**
 * The contract every provider must satisfy, applied to the whole catalog rather than to any one
 * adapter.
 *
 * This is the test that makes "adding a provider is just an adapter" enforceable instead of merely
 * intended. A new entry in the catalog is automatically held to all of it, so an adapter that forgets
 * `test()`, declares a capability set that cannot do repairs, or collides on an id fails here — not
 * in a user's session, and not in a code review someone had to remember to do.
 */

describe('provider catalog conformance', () => {
  it('registers at least the default provider and OpenAI', () => {
    const ids = allDescriptors().map((d) => d.id);
    expect(ids).toContain('openrouter');
    expect(ids).toContain('openai');
  });

  it('every provider id is unique — ids key credentials and the registry', () => {
    const ids = allDescriptors().map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every descriptor is complete enough to render and to call', () => {
    for (const d of allDescriptors()) {
      expect(d.label, d.id).toBeTruthy();
      expect(d.baseUrl, d.id).toMatch(/^https?:\/\//);
      expect(d.defaultModel, d.id).toBeTruthy();
      expect(d.capabilities.typicalContext, d.id).toBeGreaterThan(0);
    }
  });

  it('a cloud provider names where to get a key; a local one asks for none', () => {
    for (const d of allDescriptors()) {
      if (d.auth === 'api-key') {
        // Without this, a user who enables a provider has no way to find out how to configure it.
        expect(d.keyUrl, d.id).toBeTruthy();
      } else {
        expect(d.local, d.id).toBe(true);
        expect(d.keyUrl, d.id).toBeUndefined();
      }
    }
  });

  it('every registered provider can actually perform a code repair', () => {
    for (const { descriptor } of allProviders()) {
      const resolved = resolveCapabilities(descriptor.capabilities, {
        id: descriptor.defaultModel,
        // Per-model providers are given the metadata they would fetch; declared providers ignore it.
        structuredOutput: true,
        contextLength: descriptor.capabilities.typicalContext,
      });
      expect(supportsCodeRepair(resolved), descriptor.id).toBe(true);
      expect(supportsProfile('repair', resolved), descriptor.id).toBe(true);
      expect(supportsProfile('explain', resolved), descriptor.id).toBe(true);
    }
  });

  it('every adapter implements the full AIProvider interface, including test()', () => {
    for (const { descriptor, create } of allProviders()) {
      const provider = create({ apiKey: 'test-key', baseUrl: descriptor.baseUrl });
      expect(provider.id, descriptor.id).toBe(descriptor.id);
      expect(typeof provider.stream, descriptor.id).toBe('function');
      // A provider that cannot be tested can only be diagnosed by failing a real repair on the
      // user's source, which is the experience this platform exists to remove.
      expect(typeof provider.test, descriptor.id).toBe('function');
      expect(provider.capabilities.maxContext, descriptor.id).toBeGreaterThan(0);
    }
  });

  it('a provider declaring no JSON support is refused for repair, not silently attempted', () => {
    // Not currently in the catalog, but the resolver must refuse it — a model that returns prose
    // instead of a patch is a silent-corruption path in a tool that writes to source files.
    const resolved = resolveCapabilities(
      {
        streaming: 'yes',
        json: 'no',
        reasoning: 'no',
        images: 'no',
        functionCalling: 'no',
        largeContext: 'no',
        jsonStrategy: 'none',
        typicalContext: 128_000,
      },
      null,
    );
    expect(supportsCodeRepair(resolved)).toBe(false);
    expect(supportsProfile('repair', resolved)).toBe(false);
    // Explanation needs only free text, so it survives.
    expect(supportsProfile('explain', resolved)).toBe(true);
  });

  it('per-model providers refuse when metadata is missing, rather than assuming', () => {
    const openrouter = providerDescriptor('openrouter');
    expect(openrouter?.capabilities.json).toBe('per-model');
    const withoutFacts = resolveCapabilities(openrouter!.capabilities, null);
    // Absence of evidence resolves to unsupported. This is the original rule, preserved exactly
    // where the provider actually publishes the metadata to check.
    expect(withoutFacts.json).toBe(false);
    expect(withoutFacts.basis).toContain('no per-model metadata');

    const withFacts = resolveCapabilities(openrouter!.capabilities, {
      id: 'x',
      structuredOutput: true,
      contextLength: 64_000,
    });
    expect(withFacts.json).toBe(true);
    expect(withFacts.contextLength).toBe(64_000);
  });

  it('a declared provider records that the guarantee came from the provider, not a model', () => {
    const openai = providerDescriptor('openai');
    expect(openai?.capabilities.json).toBe('yes');
    const resolved = resolveCapabilities(openai!.capabilities, null);
    expect(resolved.json).toBe(true);
    // The basis is what keeps the weakened rule honest: it says who is accountable if this is wrong.
    expect(resolved.basis).toContain('provider guarantees');
  });

  it('a context window too small for a repair disqualifies the candidate', () => {
    const openai = providerDescriptor('openai');
    const tiny = resolveCapabilities(openai!.capabilities, { id: 'x', contextLength: 2_000 });
    expect(supportsCodeRepair(tiny)).toBe(false);
  });
});
