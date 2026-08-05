import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describeProviderFailure, type ProviderFailure } from '@fixora/core-ai';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { SecretCipher } from '../electron/main/ai/cipher.js';
import { createCredentialStore } from '../electron/main/ai/credentials/credential-store.js';
import {
  anyProviderConfigured,
  createOrchestrator,
} from '../electron/main/ai/providers/orchestrator.js';
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

  it('a rejected key moves to the next PROVIDER, which carries its own', async () => {
    const orchestrator = await twoProviders();
    const asked: string[] = [];
    const outcome = await orchestrator.run('repair', (candidate) => {
      asked.push(candidate.provider);
      return Promise.resolve(candidate.provider === 'openrouter' ? fail('HTTP_401') : ok('patch'));
    });
    // A bad key on provider A says nothing about provider B's, now that each holds its own. Stopping
    // here meant one stale credential at priority 1 made every provider behind it unreachable.
    expect(asked).toEqual(['openrouter', 'openai']);
    expect('refused' in outcome).toBe(false);
    if ('refused' in outcome || !outcome.ok) return;
    expect(outcome.candidate.provider).toBe('openai');
  });

  it('every key rejected reports non-retryable, having tried each credential once', async () => {
    const orchestrator = await twoProviders();
    const asked: string[] = [];
    const outcome = await orchestrator.run('repair', (candidate) => {
      asked.push(candidate.provider);
      return Promise.resolve(fail('HTTP_401'));
    });
    expect(asked).toEqual(['openrouter', 'openai']);
    expect('refused' in outcome).toBe(false);
    if ('refused' in outcome || outcome.ok) return;
    // Not "exhausted": no amount of retrying fixes a key, and the card must send them to Settings.
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

/**
 * Smart model routing. The two guarantees that matter: it NEVER overrides a model the user actually
 * picked, and provider ORDER — the thing "always follows user priority" was written about — is
 * completely untouched by any of this.
 */
describe('smart model routing', () => {
  function catalogueModel(id: string, contextLength: number, name = id) {
    return { id, name, free: true, codeCapable: true, structuredOutput: true, contextLength };
  }

  it('picks a task-appropriate model when the provider is left on auto', async () => {
    const registry = createProviderRegistry({ dir });
    const credentials = createCredentialStore({ dir, cipher: fakeCipher() });
    registry.setEnabled('openrouter', true);
    credentials.setKey('openrouter', 'k');
    // Never called setModel — this provider is "auto".
    expect(registry.modelIsAuto('openrouter')).toBe(true);

    const orchestrator = createOrchestrator({
      registry,
      credentials,
      modelFacts: (_id, model) => Promise.resolve({ id: model, structuredOutput: true, contextLength: 400_000 }),
      modelCatalogue: () =>
        Promise.resolve([
          catalogueModel('small-model', 8_000),
          catalogueModel('big-reasoning-r1', 400_000, 'Big Reasoning R1'),
        ]),
    });

    const chain = await orchestrator.resolveChain('repair', {
      complexity: 'high',
      estimatedTokens: 50_000,
    });
    expect(chain.ok).toBe(true);
    if (!chain.ok) return;
    // The small model cannot even fit the request; the reasoning model wins on top.
    expect(chain.candidates[0]?.model).toBe('big-reasoning-r1');
  });

  it('NEVER overrides a model the user explicitly chose', async () => {
    const registry = createProviderRegistry({ dir });
    const credentials = createCredentialStore({ dir, cipher: fakeCipher() });
    registry.setEnabled('openrouter', true);
    registry.setModel('openrouter', 'my-explicit-choice');
    credentials.setKey('openrouter', 'k');
    expect(registry.modelIsAuto('openrouter')).toBe(false);

    const orchestrator = createOrchestrator({
      registry,
      credentials,
      modelFacts: (_id, model) => Promise.resolve({ id: model, structuredOutput: true, contextLength: 128_000 }),
      modelCatalogue: () => Promise.resolve([catalogueModel('some-other-model', 999_999)]),
    });

    const chain = await orchestrator.resolveChain('repair', {
      complexity: 'high',
      estimatedTokens: 50_000,
    });
    expect(chain.ok && chain.candidates[0]?.model).toBe('my-explicit-choice');
  });

  it('is fully inert when no task is passed — identical to pre-routing behaviour', async () => {
    const registry = createProviderRegistry({ dir });
    const credentials = createCredentialStore({ dir, cipher: fakeCipher() });
    registry.setEnabled('openrouter', true);
    credentials.setKey('openrouter', 'k');
    const orchestrator = createOrchestrator({
      registry,
      credentials,
      modelFacts: (_id, model) => Promise.resolve({ id: model, structuredOutput: true, contextLength: 128_000 }),
      modelCatalogue: () => Promise.resolve([catalogueModel('would-be-picked', 999_999)]),
    });
    const chain = await orchestrator.resolveChain('repair'); // no task argument
    expect(chain.ok && chain.candidates[0]?.model).toBe(
      (await import('@fixora/core-ai')).openRouterDescriptor.defaultModel,
    );
  });

  it('never touches PROVIDER order — routing only ever changes which model, never who is first', async () => {
    const registry = createProviderRegistry({ dir });
    const credentials = createCredentialStore({ dir, cipher: fakeCipher() });
    for (const id of ['openrouter', 'openai']) {
      registry.setEnabled(id, true);
      credentials.setKey(id, 'k');
    }
    registry.moveUp('openai'); // openai now has priority
    const orchestrator = createOrchestrator({
      registry,
      credentials,
      modelFacts: (_id, model) => Promise.resolve({ id: model, structuredOutput: true, contextLength: 128_000 }),
      modelCatalogue: (id) =>
        Promise.resolve(id === 'openrouter' ? [catalogueModel('or-model', 400_000)] : []),
    });
    const chain = await orchestrator.resolveChain('repair', {
      complexity: 'high',
      estimatedTokens: 1_000,
    });
    expect(chain.ok && chain.candidates.map((c) => c.provider)).toEqual(['openai', 'openrouter']);
  });

  it('falls back to the resolved default when nothing in the catalogue is viable', async () => {
    const registry = createProviderRegistry({ dir });
    const credentials = createCredentialStore({ dir, cipher: fakeCipher() });
    registry.setEnabled('openrouter', true);
    credentials.setKey('openrouter', 'k');
    const orchestrator = createOrchestrator({
      registry,
      credentials,
      modelFacts: (_id, model) => Promise.resolve({ id: model, structuredOutput: true, contextLength: 128_000 }),
      modelCatalogue: () => Promise.resolve([]), // unreachable/empty catalogue
    });
    const chain = await orchestrator.resolveChain('repair', {
      complexity: 'high',
      estimatedTokens: 1_000,
    });
    expect(chain.ok).toBe(true); // still resolves — never a hard failure from routing alone
  });
});

/**
 * CREDENTIAL FRESHNESS — the scenario that made the Provider Manager necessary.
 *
 * A user burns their daily quota mid-session, pastes a new key into Settings, and repairs again. If
 * anything between the credential store and the adapter is cached — a memoised chain, a provider
 * built once at startup, a key read at boot — the next repair still uses the dead credential and the
 * only fix is a restart. These pin that the walk is rebuilt from the store on EVERY run.
 *
 * The 429 here is a test double, not a live provider call: proving this against a real quota would
 * require exhausting one on demand, and the behaviour under test is entirely local to the walk.
 */
describe('a newly saved key is used by the very next repair', () => {
  /** Wraps the real store so the exact key handed to each adapter build is observable. */
  function recording() {
    const registry = createProviderRegistry({ dir });
    const credentials = createCredentialStore({ dir, cipher: fakeCipher() });
    const reads: { provider: string; key: string | null }[] = [];
    const spy: typeof credentials = {
      ...credentials,
      getKey: (id: string) => {
        const key = credentials.getKey(id);
        reads.push({ provider: id, key });
        return key;
      },
    };
    const orchestrator = createOrchestrator({
      registry,
      credentials: spy,
      modelFacts: (_p, model) =>
        Promise.resolve({ id: model, structuredOutput: true, contextLength: 128_000 }),
    });
    return { registry, credentials, orchestrator, reads };
  }

  it('SKIPS an enabled provider with no key instead of spending a request on it', async () => {
    const { registry, credentials, orchestrator } = build();
    for (const id of ['openrouter', 'openai']) registry.setEnabled(id, true);
    // Only the second one is credentialed.
    credentials.setKey('openai', 'sk-oa');

    const asked: string[] = [];
    const outcome = await orchestrator.run('repair', (candidate) => {
      asked.push(candidate.provider);
      return Promise.resolve(ok('patch'));
    });

    // Silently skipped — not attempted and not reported as a failure, because a missing key is a
    // configuration state rather than a provider error.
    expect(asked).toEqual(['openai']);
    expect('refused' in outcome).toBe(false);
    if ('refused' in outcome || !outcome.ok) return;
    expect(outcome.candidate.provider).toBe('openai');
  });

  it('after a 429 exhausts the chain, a key added to ANOTHER provider is used immediately', async () => {
    const { registry, credentials, orchestrator } = build();
    registry.setEnabled('openrouter', true);
    credentials.setKey('openrouter', 'sk-or-dead');

    // Run 1: the only credentialed provider is out of quota.
    const first = await orchestrator.run('repair', () =>
      Promise.resolve(fail('HTTP_429', 'free-models-per-day exhausted')),
    );
    expect('refused' in first).toBe(false);
    if ('refused' in first || first.ok) return;
    expect(first.reason).toBe('exhausted');

    // The user pastes a key for a different provider and enables it — exactly what
    // `providers:setKey` does in main. No restart, no cache flush, same orchestrator instance.
    credentials.setKey('openai', 'sk-oa-fresh');
    registry.setEnabled('openai', true);

    const asked: string[] = [];
    const second = await orchestrator.run('repair', (candidate) => {
      asked.push(candidate.provider);
      return Promise.resolve(
        candidate.provider === 'openrouter' ? fail('HTTP_429', 'still exhausted') : ok('patch'),
      );
    });

    expect(asked).toEqual(['openrouter', 'openai']);
    expect('refused' in second).toBe(false);
    if ('refused' in second || !second.ok) return;
    expect(second.value).toBe('patch');
    expect(second.candidate.provider).toBe('openai');
  });

  it('a REPLACED key on the same provider reaches the adapter on the next run', async () => {
    const { credentials, registry, orchestrator, reads } = recording();
    registry.setEnabled('openrouter', true);
    credentials.setKey('openrouter', 'sk-or-dead');

    await orchestrator.run('repair', () => Promise.resolve(fail('HTTP_429', 'quota')));
    expect(reads.at(-1)).toEqual({ provider: 'openrouter', key: 'sk-or-dead' });

    // Same provider, new key — the case a per-provider field finally makes possible.
    credentials.setKey('openrouter', 'sk-or-fresh');

    const outcome = await orchestrator.run('repair', () => Promise.resolve(ok('patch')));
    // Re-read from the store for this run, not carried over from the last one.
    expect(reads.at(-1)).toEqual({ provider: 'openrouter', key: 'sk-or-fresh' });
    expect('refused' in outcome).toBe(false);
    if ('refused' in outcome || !outcome.ok) return;
    expect(outcome.value).toBe('patch');
  });

  it('a key REMOVED mid-session stops being offered, without a restart', async () => {
    const { credentials, registry, orchestrator } = build();
    for (const id of ['openrouter', 'openai']) {
      registry.setEnabled(id, true);
      credentials.setKey(id, 'k');
    }
    expect((await orchestrator.resolveChain('repair')).ok).toBe(true);

    credentials.clearKey('openrouter');

    const chain = await orchestrator.resolveChain('repair');
    // Still enabled, simply not attemptable — the row keeps its place and its "no key" badge.
    expect(chain.ok && chain.candidates.map((c) => c.provider)).toEqual(['openai']);
    expect(registry.enabled().map((s) => s.id)).toContain('openrouter');
  });

  it('the chain is rebuilt per run — a provider enabled between runs appears without one', async () => {
    const { credentials, registry, orchestrator } = build();
    credentials.setKey('openai', 'sk-oa');
    registry.setEnabled('openrouter', true);
    credentials.setKey('openrouter', 'sk-or');
    expect((await orchestrator.resolveChain('repair')).ok).toBe(true);

    registry.setEnabled('openai', true);
    const chain = await orchestrator.resolveChain('repair');
    expect(chain.ok && chain.candidates.map((c) => c.provider)).toEqual(['openrouter', 'openai']);
  });
});

/**
 * "IS AI SET UP?" — the predicate behind the Problems panel's button.
 *
 * This shipped answered by the legacy single-key store (`key-store.ts:81`, `keyEnc !== null`), which
 * only `ai:setKey` writes and only for OpenRouter. A user who configured Gemini through the Provider
 * Manager therefore had a registry, a credential and a working chain — and a panel offering "Set up
 * AI to repair" with Repair disabled. The panel and the walk must answer this identically, so they
 * now share `providerCredential`.
 */
describe('anyProviderConfigured — the same rule the chain walk applies', () => {
  it('is false on a fresh install: nothing enabled, nothing stored', () => {
    const { registry, credentials } = build();
    expect(anyProviderConfigured(registry, credentials)).toBe(false);
  });

  it('is TRUE for a provider that is not OpenRouter — the whole bug', () => {
    const { registry, credentials } = build();
    registry.setEnabled('gemini', true);
    credentials.setKey('gemini', 'AIza-test');
    // Nothing was ever written to the legacy store, which is exactly the state that showed
    // "Set up AI to repair" over a chain that would have answered.
    expect(anyProviderConfigured(registry, credentials)).toBe(true);
  });

  it('is false when a provider is enabled but has no key', () => {
    const { registry, credentials } = build();
    registry.setEnabled('gemini', true);
    expect(anyProviderConfigured(registry, credentials)).toBe(false);
  });

  it('is false when a key exists but its provider is disabled', () => {
    const { registry, credentials } = build();
    credentials.setKey('gemini', 'AIza-test');
    registry.setEnabled('gemini', false);
    expect(anyProviderConfigured(registry, credentials)).toBe(false);
  });

  it('is true for an enabled LOCAL provider, which needs no key at all', () => {
    const { registry, credentials } = build();
    registry.setEnabled('ollama', true);
    // Asking for an API key to reach a daemon on your own machine would be nonsense, and the walk
    // already treats it as a usable candidate — so the panel must not call it unconfigured.
    expect(anyProviderConfigured(registry, credentials)).toBe(true);
  });

  it('agrees with resolveChain — it never claims setup the walk would refuse', async () => {
    const { registry, credentials, orchestrator } = build();
    registry.setEnabled('gemini', true);
    credentials.setKey('gemini', 'AIza-test');

    expect(anyProviderConfigured(registry, credentials)).toBe(true);
    const chain = await orchestrator.resolveChain('repair');
    expect(chain.ok).toBe(true);

    // And the converse: clearing the key must flip both, in the same direction.
    credentials.clearKey('gemini');
    expect(anyProviderConfigured(registry, credentials)).toBe(false);
    const after = await orchestrator.resolveChain('repair');
    expect(after.ok).toBe(false);
    if (after.ok) return;
    expect(after.reason).toBe('no-credentials');
  });
});

/**
 * Model persistence, end to end through the REAL registry.
 *
 * `providers:setModel` and its registry write both existed and both worked; nothing in the renderer
 * ever called them, and the only model control in Settings wrote the legacy single-provider store
 * that the chain does not read. So a changed model persisted nowhere the orchestrator would look, and
 * the next repair used the old one. These pin the read-back the orchestrator actually performs.
 */
describe('a provider’s model persists and is read back', () => {
  it('setModel is what the chain uses on the next run', async () => {
    const { registry, credentials, orchestrator } = build();
    registry.setEnabled('gemini', true);
    credentials.setKey('gemini', 'AIza-x');

    // Descriptor default first — nothing chosen yet.
    let chain = await orchestrator.resolveChain('repair');
    expect(chain.ok && chain.candidates[0]?.model).toBe('gemini-2.0-flash');

    registry.setModel('gemini', 'gemini-2.5-pro');

    chain = await orchestrator.resolveChain('repair');
    expect(chain.ok && chain.candidates[0]?.model).toBe('gemini-2.5-pro');
  });

  it('survives a reload — it is on disk, not in memory', () => {
    const first = createProviderRegistry({ dir });
    first.setEnabled('gemini', true);
    first.setModel('gemini', 'gemini-2.5-pro');

    // A second registry over the same directory is what the next app launch constructs.
    const reloaded = createProviderRegistry({ dir });
    expect(reloaded.get('gemini')?.model).toBe('gemini-2.5-pro');
    expect(reloaded.modelIsAuto('gemini')).toBe(false);
  });

  it('clearing it returns to the descriptor default', () => {
    const registry = createProviderRegistry({ dir });
    registry.setModel('gemini', 'gemini-2.5-pro');
    registry.setModel('gemini', '');
    // Empty is stored as "follow the default", not as a model literally named "".
    expect(registry.get('gemini')?.model).toBe('gemini-2.0-flash');
    expect(registry.modelIsAuto('gemini')).toBe(true);
  });

  it('sets the model for ONE provider only', () => {
    const registry = createProviderRegistry({ dir });
    registry.setModel('gemini', 'gemini-2.5-pro');
    expect(registry.get('openrouter')?.model).not.toBe('gemini-2.5-pro');
  });
});
