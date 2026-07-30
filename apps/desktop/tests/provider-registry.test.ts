import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { providerDescriptor } from '@fixora/core-ai';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createProviderRegistry } from '../electron/main/ai/providers/provider-registry.js';

/**
 * The registry decides which providers run and in what order, and the orchestrator does nothing but
 * walk it. So "the orchestrator always follows user priority" is really a claim about this file.
 */

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'fx-registry-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('provider registry', () => {
  it('a fresh install knows every provider and has none enabled', () => {
    const registry = createProviderRegistry({ dir });
    const ids = registry.list().map((p) => p.id);
    expect(ids).toContain('openrouter');
    expect(ids).toContain('openai');
    // Enabling something that can send source code off the machine is the user's decision, not a
    // default. A fresh install sends nothing anywhere until someone says so.
    expect(registry.enabled()).toEqual([]);
  });

  it('resolves the descriptor default when the user has picked no model', () => {
    const registry = createProviderRegistry({ dir });
    expect(registry.get('openai')?.model).toBe(providerDescriptor('openai')?.defaultModel);
  });

  it('a chosen model wins over the default and survives a reload', () => {
    createProviderRegistry({ dir }).setModel('openai', 'gpt-4.1');
    expect(createProviderRegistry({ dir }).get('openai')?.model).toBe('gpt-4.1');
  });

  it('enable and disable persist', () => {
    createProviderRegistry({ dir }).setEnabled('openai', true);
    const reloaded = createProviderRegistry({ dir });
    expect(reloaded.get('openai')?.enabled).toBe(true);
    expect(reloaded.enabled().map((p) => p.id)).toEqual(['openai']);
  });

  it('never persists a secret — the registry is preferences only', () => {
    const registry = createProviderRegistry({ dir });
    registry.setEnabled('openrouter', true);
    registry.setModel('openrouter', 'some/model');
    const raw = readFileSync(join(dir, 'ai-registry.json'), 'utf8');
    expect(raw).not.toContain('key');
    expect(raw).not.toContain('sk-');
  });
});

describe('priority ordering', () => {
  it('Move Up and Move Down reorder, and the order persists', () => {
    const registry = createProviderRegistry({ dir });
    const before = registry.list().map((p) => p.id);
    expect(before[0]).toBe('openrouter'); // the default ships first

    registry.moveUp('openai');
    expect(createProviderRegistry({ dir }).list().map((p) => p.id)).toEqual([
      'openai',
      'openrouter',
    ]);

    createProviderRegistry({ dir }).moveDown('openai');
    expect(createProviderRegistry({ dir }).list().map((p) => p.id)).toEqual([
      'openrouter',
      'openai',
    ]);
  });

  it('moving past either end is a no-op, not a wrap or a crash', () => {
    const registry = createProviderRegistry({ dir });
    const order = registry.list().map((p) => p.id);
    registry.moveUp(order[0]!);
    registry.moveDown(order[order.length - 1]!);
    expect(registry.list().map((p) => p.id)).toEqual(order);
  });

  it('moving an unknown provider does nothing', () => {
    const registry = createProviderRegistry({ dir });
    const order = registry.list().map((p) => p.id);
    registry.moveUp('does-not-exist');
    expect(registry.list().map((p) => p.id)).toEqual(order);
  });

  it('enabled() preserves priority order, not insertion order', () => {
    const registry = createProviderRegistry({ dir });
    registry.setEnabled('openrouter', true);
    registry.setEnabled('openai', true);
    registry.moveUp('openai');
    expect(registry.enabled().map((p) => p.id)).toEqual(['openai', 'openrouter']);
  });
});

describe('reconciliation across versions', () => {
  it('a provider shipped since the file was written appears, disabled', () => {
    // A file from a build that only knew OpenRouter.
    writeFileSync(
      join(dir, 'ai-registry.json'),
      JSON.stringify({
        version: 1,
        order: ['openrouter'],
        settings: { openrouter: { enabled: true, model: 'm', baseUrl: '' } },
      }),
    );
    const registry = createProviderRegistry({ dir });
    expect(registry.list().map((p) => p.id)).toEqual(['openrouter', 'openai']);
    // Present so it is visible in Settings; inert until the user chooses it.
    expect(registry.get('openai')?.enabled).toBe(false);
    // And the existing provider is untouched.
    expect(registry.get('openrouter')).toMatchObject({ enabled: true, model: 'm' });
  });

  it('a provider no longer in the catalog is dropped rather than kept as a ghost', () => {
    writeFileSync(
      join(dir, 'ai-registry.json'),
      JSON.stringify({
        version: 1,
        order: ['retired-provider', 'openrouter'],
        settings: { 'retired-provider': { enabled: true, model: 'x', baseUrl: '' } },
      }),
    );
    const registry = createProviderRegistry({ dir });
    expect(registry.list().map((p) => p.id)).not.toContain('retired-provider');
    expect(registry.enabled()).toEqual([]);
  });

  it('a corrupt file falls back to a clean default rather than crashing startup', () => {
    writeFileSync(join(dir, 'ai-registry.json'), 'not json');
    expect(createProviderRegistry({ dir }).list().length).toBeGreaterThan(0);
  });
});

/**
 * BACKWARD COMPATIBILITY. An existing OpenRouter user upgrades and must find themselves exactly
 * where they were: enabled, first in priority, on the model they chose.
 */
describe('migration from v1 settings', () => {
  function writeLegacy(model: string): void {
    writeFileSync(
      join(dir, 'ai-credentials.json'),
      JSON.stringify({ keyEnc: 'enc', hint: '••••', model }),
    );
  }

  it('adopts the stored model and enables OpenRouter first', () => {
    writeLegacy('anthropic/claude-3.5-sonnet');
    const registry = createProviderRegistry({ dir });
    const openrouter = registry.get('openrouter');
    expect(openrouter?.enabled).toBe(true);
    expect(openrouter?.model).toBe('anthropic/claude-3.5-sonnet');
    expect(registry.enabled().map((p) => p.id)).toEqual(['openrouter']);
    expect(registry.list()[0]?.id).toBe('openrouter');
  });

  it('does not enable any provider the user never configured', () => {
    writeLegacy('some/model');
    expect(createProviderRegistry({ dir }).get('openai')?.enabled).toBe(false);
  });

  it('a fresh install with no v1 file enables nothing', () => {
    expect(createProviderRegistry({ dir }).enabled()).toEqual([]);
  });

  it('once migrated, a later disable is respected rather than re-migrated', () => {
    writeLegacy('some/model');
    createProviderRegistry({ dir }).setEnabled('openrouter', false);
    expect(createProviderRegistry({ dir }).get('openrouter')?.enabled).toBe(false);
  });
});
