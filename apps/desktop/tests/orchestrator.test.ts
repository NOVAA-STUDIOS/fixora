import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describeProviderFailure, type ProviderFailure } from '@fixora/core-ai';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { SecretCipher } from '../electron/main/ai/cipher.js';
import { createCredentialStore } from '../electron/main/ai/credentials/credential-store.js';
import { createOrchestrator } from '../electron/main/ai/providers/orchestrator.js';
import { createProviderRegistry } from '../electron/main/ai/providers/provider-registry.js';

/**
 * The orchestrator, against the REAL registry and credential store.
 *
 * This is where "the orchestrator always follows user priority" and "a new provider needs only an
 * adapter" stop being claims. Every test below drives selection purely through configuration —
 * enable a provider, order it, give it a key — and never names a provider inside the pipeline.
 */

function fakeCipher(): SecretCipher {
  return {
    isAvailable: () => true,
    encrypt: (plaintext) => Buffer.from(`enc:${plaintext}`).toString('base64'),
    decrypt: (ciphertext) => {
      const decoded = Buffer.from(ciphertext, 'base64').toString('utf8');
      if (!decoded.startsWith('enc:')) throw new Error('bad ciphertext');
      return decoded.slice('enc:'.length);
    },
  };
}

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'fx-orch-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function build() {
  const registry = createProviderRegistry({ dir });
  const credentials = createCredentialStore({ dir, cipher: fakeCipher() });
  const orchestrator = createOrchestrator({
    registry,
    credentials,
    // Stand in for OpenRouter's catalogue: its capabilities are `per-model`, so without facts it
    // correctly refuses. Supplying capable facts is what a reachable catalogue would do.
    modelFacts: (_providerId, model) =>
      Promise.resolve({ id: model, structuredOutput: true, contextLength: 128_000 }),
  });
  return { registry, credentials, orchestrator };
}

const ok = (value: string) => ({ ok: true as const, value });
const fail = (code: string, detail = '') => ({
  ok: false as const,
  failure: describeProviderFailure({ providerCode: code, detail }),
});

describe('chain construction follows the user', () => {
  it('refuses with `none-enabled` when nothing is turned on', async () => {
    const { orchestrator } = build();
    const chain = await orchestrator.resolveChain('repair');
    expect(chain.ok).toBe(false);
    if (chain.ok) return;
    expect(chain.reason).toBe('none-enabled');
  });

  it('refuses with `no-credentials` when a provider is on but has no key', async () => {
    const { registry, orchestrator } = build();
    registry.setEnabled('openrouter', true);
    const chain = await orchestrator.resolveChain('repair');
    expect(chain.ok).toBe(false);
    if (chain.ok) return;
    // A different fix from `none-enabled`, and collapsing the two would send the user to the wrong
    // place in Settings.
    expect(chain.reason).toBe('no-credentials');
  });

  it('includes an enabled, credentialed, capable provider', async () => {
    const { registry, credentials, orchestrator } = build();
    registry.setEnabled('openrouter', true);
    credentials.setKey('openrouter', 'sk-or-1');
    const chain = await orchestrator.resolveChain('repair');
    expect(chain.ok).toBe(true);
    if (!chain.ok) return;
    expect(chain.candidates.map((c) => c.provider)).toEqual(['openrouter']);
    // The adapter is live and carries its own credential — that is what makes cross-provider
    // failover possible at all.
    expect(chain.candidates[0]?.adapter.id).toBe('openrouter');
  });

  it('EXCLUDES a disabled provider even when it has a key', async () => {
    const { registry, credentials, orchestrator } = build();
    credentials.setKey('openai', 'sk-oa-1');
    registry.setEnabled('openai', false);
    registry.setEnabled('openrouter', true);
    credentials.setKey('openrouter', 'sk-or-1');
    const chain = await orchestrator.resolveChain('repair');
    expect(chain.ok).toBe(true);
    if (!chain.ok) return;
    expect(chain.candidates.map((c) => c.provider)).toEqual(['openrouter']);
  });

  it('ORDERS candidates by the user’s priority, not by catalog order', async () => {
    const { registry, credentials, orchestrator } = build();
    for (const id of ['openrouter', 'openai']) {
      registry.setEnabled(id, true);
      credentials.setKey(id, `sk-${id}`);
    }
    expect((await orchestrator.resolveChain('repair')).ok).toBe(true);
    // Default catalog order puts OpenRouter first.
    let chain = await orchestrator.resolveChain('repair');
    expect(chain.ok && chain.candidates.map((c) => c.provider)).toEqual(['openrouter', 'openai']);

    registry.moveUp('openai');
    chain = await orchestrator.resolveChain('repair');
    // The orchestrator followed the user, with no code aware of either provider's name.
    expect(chain.ok && chain.candidates.map((c) => c.provider)).toEqual(['openai', 'openrouter']);
  });

  it('uses each provider’s own configured model', async () => {
    const { registry, credentials, orchestrator } = build();
    for (const id of ['openrouter', 'openai']) {
      registry.setEnabled(id, true);
      credentials.setKey(id, 'k');
    }
    registry.setModel('openrouter', 'or/custom');
    registry.setModel('openai', 'gpt-4.1');
    const chain = await orchestrator.resolveChain('repair');
    expect(chain.ok && chain.candidates.map((c) => c.model)).toEqual(['or/custom', 'gpt-4.1']);
  });
});

describe('failover across providers', () => {
  async function twoProviders() {
    const { registry, credentials, orchestrator } = build();
    for (const id of ['openrouter', 'openai']) {
      registry.setEnabled(id, true);
      credentials.setKey(id, 'k');
    }
    return orchestrator;
  }

  it('the first provider fails and the SECOND PROVIDER answers', async () => {
    const orchestrator = await twoProviders();
    const asked: string[] = [];
    const outcome = await orchestrator.run('repair', (candidate) => {
      asked.push(candidate.provider);
      return Promise.resolve(candidate.provider === 'openrouter' ? fail('HTTP_503') : ok('patch'));
    });

    expect(asked).toEqual(['openrouter', 'openai']);
    expect('refused' in outcome).toBe(false);
    if ('refused' in outcome || !outcome.ok) return;
    expect(outcome.value).toBe('patch');
    expect(outcome.candidate.provider).toBe('openai');
  });

  it('quota exhausted on the first provider moves to the second', async () => {
    const orchestrator = await twoProviders();
    const outcome = await orchestrator.run('repair', (candidate) =>
      Promise.resolve(
        candidate.provider === 'openrouter'
          ? fail('HTTP_429', 'free-models-per-day exhausted')
          : ok('patch'),
      ),
    );
    expect('refused' in outcome).toBe(false);
    if ('refused' in outcome || !outcome.ok) return;
    expect(outcome.candidate.provider).toBe('openai');
  });

  it('a rejected key stops the walk — the second provider is never contacted', async () => {
    const orchestrator = await twoProviders();
    const asked: string[] = [];
    const outcome = await orchestrator.run('repair', (candidate) => {
      asked.push(candidate.provider);
      return Promise.resolve(fail('HTTP_401'));
    });
    // A bad key on provider A says nothing about provider B — but it is not an availability
    // failure, and the user's fix is to correct the key they just entered.
    expect(asked).toEqual(['openrouter']);
    expect('refused' in outcome).toBe(false);
    if ('refused' in outcome || outcome.ok) return;
    expect(outcome.reason).toBe('non-retryable');
  });

  it('every provider failing reports the last failure and the full walk', async () => {
    const orchestrator = await twoProviders();
    const outcome = await orchestrator.run('repair', () => Promise.resolve(fail('HTTP_503')));
    expect('refused' in outcome).toBe(false);
    if ('refused' in outcome || outcome.ok) return;
    expect(outcome.reason).toBe('exhausted');
    expect(outcome.attempts.map((a) => a.candidate.provider)).toEqual(['openrouter', 'openai']);
  });

  it('a successful first provider contacts nothing else', async () => {
    const orchestrator = await twoProviders();
    let calls = 0;
    await orchestrator.run('repair', () => {
      calls += 1;
      return Promise.resolve(ok('patch'));
    });
    expect(calls).toBe(1);
  });
});

/**
 * THE ARCHITECTURE PROOF.
 *
 * Switching the active provider is configuration, not code. The block below moves between providers
 * and asserts that the pipeline above the orchestrator is handed a working candidate every time —
 * with no branch anywhere naming a provider, and nothing in the repair engine, parser, verifier or
 * Apply gate consulted at all.
 */
describe('switching the active provider requires no code change', () => {
  it('runs the identical attempt function against each provider in turn', async () => {
    const { registry, credentials, orchestrator } = build();
    for (const id of ['openrouter', 'openai']) credentials.setKey(id, 'k');

    // ONE attempt function, reused verbatim for every provider. It receives an adapter and a model
    // and knows nothing else — which is exactly what the repair pipeline does.
    const attempt = (candidate: { provider: string; model: string }) =>
      Promise.resolve(ok(`${candidate.provider}:${candidate.model}`));

    const results: string[] = [];
    for (const active of ['openrouter', 'openai']) {
      for (const id of ['openrouter', 'openai']) registry.setEnabled(id, id === active);
      const outcome = await orchestrator.run('repair', attempt);
      if ('refused' in outcome || !outcome.ok) throw new Error(`no candidate for ${active}`);
      results.push(outcome.value);
      expect(outcome.candidate.provider).toBe(active);
    }

    expect(results).toEqual([
      'openrouter:openai/gpt-oss-20b:free',
      'openai:gpt-4.1-mini',
    ]);
  });

  it('a provider with no key is skipped rather than failing the run', async () => {
    const { registry, credentials, orchestrator } = build();
    for (const id of ['openrouter', 'openai']) registry.setEnabled(id, true);
    // Only the second has a key. The first is skipped at chain construction, so the run succeeds
    // instead of spending a request to discover a missing credential.
    credentials.setKey('openai', 'k');
    const chain = await orchestrator.resolveChain('repair');
    expect(chain.ok && chain.candidates.map((c) => c.provider)).toEqual(['openai']);
  });
});

describe('capability gating', () => {
  it('refuses a repair when no enabled provider can produce schema-constrained JSON', async () => {
    const registry = createProviderRegistry({ dir });
    const credentials = createCredentialStore({ dir, cipher: fakeCipher() });
    registry.setEnabled('openrouter', true);
    credentials.setKey('openrouter', 'k');
    // OpenRouter's capabilities are `per-model`; an unreachable catalogue means no facts, and
    // absence of evidence must resolve to unsupported rather than to optimism.
    const orchestrator = createOrchestrator({
      registry,
      credentials,
      modelFacts: () => Promise.resolve(null),
    });

    const chain = await orchestrator.resolveChain('repair');
    expect(chain.ok).toBe(false);
    if (chain.ok) return;
    expect(chain.reason).toBe('no-capable-provider');
  });

  it('the same provider still serves `explain`, which needs no schema', async () => {
    const registry = createProviderRegistry({ dir });
    const credentials = createCredentialStore({ dir, cipher: fakeCipher() });
    registry.setEnabled('openrouter', true);
    credentials.setKey('openrouter', 'k');
    const orchestrator = createOrchestrator({
      registry,
      credentials,
      modelFacts: () => Promise.resolve(null),
    });
    expect((await orchestrator.resolveChain('explain')).ok).toBe(true);
  });

  it('a provider that declares JSON support needs no per-model metadata', async () => {
    const { registry, credentials } = build();
    registry.setEnabled('openai', true);
    credentials.setKey('openai', 'k');
    const orchestrator = createOrchestrator({
      registry,
      credentials,
      modelFacts: () => Promise.resolve(null),
    });
    const chain = await orchestrator.resolveChain('repair');
    expect(chain.ok && chain.candidates.map((c) => c.provider)).toEqual(['openai']);
  });
});

describe('backward compatibility for an existing OpenRouter user', () => {
  it('an upgraded v1 install resolves a working OpenRouter chain with no new configuration', async () => {
    // Exactly what an existing user's profile directory looks like before this release.
    const { writeFileSync } = await import('node:fs');
    writeFileSync(
      join(dir, 'ai-credentials.json'),
      JSON.stringify({
        keyEnc: Buffer.from('enc:sk-or-existing').toString('base64'),
        hint: '••••ting',
        model: 'openai/gpt-oss-20b:free',
      }),
    );

    const { orchestrator } = build();
    const chain = await orchestrator.resolveChain('repair');

    expect(chain.ok).toBe(true);
    if (!chain.ok) return;
    // Enabled, first, on their model, with their key — without the user doing anything.
    expect(chain.candidates[0]?.provider).toBe('openrouter');
    expect(chain.candidates[0]?.model).toBe('openai/gpt-oss-20b:free');
  });
});

/** A failure shape sanity check, so the tests above cannot pass on a mis-shaped fake. */
describe('failure fixtures match the real classifier', () => {
  it('503 is provider-unavailable and 401 is a configuration failure', () => {
    const down: ProviderFailure = fail('HTTP_503').failure;
    expect(down.category).toBe('provider-unavailable');
    expect(fail('HTTP_401').failure.layer).toBe('configuration');
  });
});
