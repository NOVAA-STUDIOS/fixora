import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * Provider management IPC.
 *
 * The registry, the failover chain and the health store were all built and tested, and none of them
 * was reachable: no channel named them. These pin the surface that fixes that — and, more
 * importantly, the two properties that make it safe to expose at all.
 *
 * **No credential crosses.** The list reports `hasKey` as a boolean and nothing else about the key.
 * **Main owns the order.** Every mutation answers with the refreshed list, so the renderer never
 * re-derives an ordering main has already computed.
 */
type Handler = (payload: unknown) => Promise<unknown> | unknown;

interface Row {
  id: string;
  enabled: boolean;
  model: string;
  baseUrl: string;
}

async function harness(initial: Row[] = [
  { id: 'openrouter', enabled: true, model: '', baseUrl: '' },
  { id: 'openai', enabled: false, model: 'gpt-4.1-mini', baseUrl: '' },
  { id: 'ollama', enabled: false, model: '', baseUrl: '' },
]) {
  vi.resetModules();
  const rows = [...initial];

  const registry = {
    list: () => rows,
    enabled: () => rows.filter((r) => r.enabled),
    get: (id: string) => rows.find((r) => r.id === id) ?? null,
    modelIsAuto: (id: string) => (rows.find((r) => r.id === id)?.model ?? '') === '',
    setEnabled: vi.fn((id: string, enabled: boolean) => {
      const row = rows.find((r) => r.id === id);
      if (row !== undefined) row.enabled = enabled;
    }),
    setModel: vi.fn((id: string, model: string) => {
      const row = rows.find((r) => r.id === id);
      if (row !== undefined) row.model = model;
    }),
    setBaseUrl: vi.fn((id: string, baseUrl: string) => {
      const row = rows.find((r) => r.id === id);
      if (row !== undefined) row.baseUrl = baseUrl;
    }),
    moveUp: vi.fn((id: string) => {
      const i = rows.findIndex((r) => r.id === id);
      if (i > 0) [rows[i - 1], rows[i]] = [rows[i] as Row, rows[i - 1] as Row];
    }),
    makePrimary: vi.fn((id: string) => {
      const i = rows.findIndex((r) => r.id === id);
      if (i > 0) rows.unshift(...rows.splice(i, 1));
    }),
    moveDown: vi.fn((id: string) => {
      const i = rows.findIndex((r) => r.id === id);
      if (i >= 0 && i < rows.length - 1) [rows[i], rows[i + 1]] = [rows[i + 1] as Row, rows[i] as Row];
    }),
  };

  // A real map, so "did saving gemini disturb openrouter" is an observable fact rather than a
  // question about call arguments.
  const keys = new Map<string, string>();
  const credentials = {
    hasKey: vi.fn((id: string) => keys.has(id)),
    hint: vi.fn((id: string) => {
      const key = keys.get(id);
      return key === undefined ? null : `••••${key.slice(-4)}`;
    }),
    setKey: vi.fn((id: string, key: string) => keys.set(id, key)),
    clearKey: vi.fn((id: string) => keys.delete(id)),
  };
  const onCredentialChange = vi.fn();
  const health = {
    get: vi.fn((id: string) =>
      id === 'openrouter'
        ? {
            providerId: 'openrouter',
            label: 'OpenRouter',
            enabled: true,
            status: 'rate-limited' as const,
            model: 'm',
            latencyMs: 412,
            lastSuccessAt: 1,
            lastFailureAt: 2,
            lastFailureCategory: 'quota-exceeded',
            quotaRemaining: 0,
            quotaLimit: 50,
            quotaResetAt: 3,
            checkedAt: 4,
          }
        : null,
    ),
  };

  const { getHandler } = await import('../electron/main/ipc/router.js');
  const { registerProviderHandlers } = await import(
    '../electron/main/ipc/handlers/providers.handlers.js'
  );
  registerProviderHandlers({
    registry: registry as never,
    credentials: credentials as never,
    health: health as never,
    onCredentialChange,
  });

  const call = async (
    channel: Parameters<typeof getHandler>[0],
    payload: unknown = {},
  ): Promise<{ providers: unknown[] }> =>
    (await (getHandler(channel) as unknown as Handler)(payload)) as { providers: unknown[] };

  return { call, registry, credentials, rows, keys, onCredentialChange };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('providers:list — joins descriptor, registry and health', () => {
  it('returns every registered provider in priority order, 1-based', async () => {
    const { call } = await harness();
    const { providers } = (await call('providers:list')) as {
      providers: { id: string; priority: number; label: string }[];
    };
    expect(providers.map((p) => p.id)).toEqual(['openrouter', 'openai', 'ollama']);
    expect(providers.map((p) => p.priority)).toEqual([1, 2, 3]);
    // Labels come from the descriptor, not the raw id.
    expect(providers[2]?.label).toBe('Ollama (local)');
  });

  it('resolves an empty model to the descriptor default, and flags it as auto', async () => {
    const { call } = await harness();
    const { providers } = (await call('providers:list')) as {
      providers: { id: string; model: string; modelIsAuto: boolean }[];
    };
    const openai = providers.find((p) => p.id === 'openai');
    expect(openai?.model).toBe('gpt-4.1-mini');
    expect(openai?.modelIsAuto).toBe(false);
    expect(providers.find((p) => p.id === 'ollama')?.modelIsAuto).toBe(true);
  });

  it('reports hasKey as a BOOLEAN and never any key material', async () => {
    // The whole point: this channel must not become a second way to read a credential.
    const { call, keys } = await harness();
    keys.set('openrouter', 'sk-or-secret-value');
    const { providers } = await call('providers:list');
    const serialised = JSON.stringify(providers);
    expect(serialised).not.toMatch(/sk-/);
    expect(serialised).not.toMatch(/keyEnc|apiKey|secret/i);
    expect((providers as { id: string; hasKey: boolean }[]).find((p) => p.id === 'openrouter')?.hasKey).toBe(true);
  });

  it('treats a local provider as always having a credential — it needs none', async () => {
    const { call, credentials } = await harness();
    const { providers } = (await call('providers:list')) as {
      providers: { id: string; hasKey: boolean; requiresKey: boolean; local: boolean }[];
    };
    const ollama = providers.find((p) => p.id === 'ollama');
    expect(ollama?.requiresKey).toBe(false);
    expect(ollama?.hasKey).toBe(true);
    expect(ollama?.local).toBe(true);
    // And the credential store is never consulted for it.
    expect(credentials.hasKey).not.toHaveBeenCalledWith('ollama');
  });

  it('carries health when it exists and NULL when it does not', async () => {
    // Null is "never exercised", which must stay distinguishable from unhealthy.
    const { call } = await harness();
    const { providers } = (await call('providers:list')) as {
      providers: { id: string; health: { status: string; quotaRemaining: number } | null }[];
    };
    expect(providers.find((p) => p.id === 'openrouter')?.health?.status).toBe('rate-limited');
    expect(providers.find((p) => p.id === 'openrouter')?.health?.quotaRemaining).toBe(0);
    expect(providers.find((p) => p.id === 'openai')?.health).toBeNull();
  });
});

describe('provider mutations — main stays the authority on order', () => {
  it('setEnabled writes through and returns the refreshed list', async () => {
    const { call, registry } = await harness();
    const { providers } = (await call('providers:setEnabled', {
      id: 'openai',
      enabled: true,
    })) as { providers: { id: string; enabled: boolean }[] };
    expect(registry.setEnabled).toHaveBeenCalledWith('openai', true);
    expect(providers.find((p) => p.id === 'openai')?.enabled).toBe(true);
  });

  it('moveUp reorders, and the RESPONSE carries the new order', async () => {
    // The renderer must never have to recompute this locally.
    const { call } = await harness();
    const { providers } = (await call('providers:moveUp', { id: 'openai' })) as {
      providers: { id: string; priority: number }[];
    };
    expect(providers.map((p) => p.id)).toEqual(['openai', 'openrouter', 'ollama']);
    expect(providers.map((p) => p.priority)).toEqual([1, 2, 3]);
  });

  it('moveDown reorders the other way', async () => {
    const { call } = await harness();
    const { providers } = (await call('providers:moveDown', { id: 'openrouter' })) as {
      providers: { id: string }[];
    };
    expect(providers.map((p) => p.id)).toEqual(['openai', 'openrouter', 'ollama']);
  });

  it('moving past an end is a no-op, not a wrap', async () => {
    const { call } = await harness();
    const up = (await call('providers:moveUp', { id: 'openrouter' })) as {
      providers: { id: string }[];
    };
    expect(up.providers.map((p) => p.id)).toEqual(['openrouter', 'openai', 'ollama']);
    const down = (await call('providers:moveDown', { id: 'ollama' })) as {
      providers: { id: string }[];
    };
    expect(down.providers.map((p) => p.id)).toEqual(['openrouter', 'openai', 'ollama']);
  });

  it('setModel and setBaseUrl write through', async () => {
    const { call, registry } = await harness();
    await call('providers:setModel', { id: 'ollama', model: 'qwen2.5-coder:7b' });
    expect(registry.setModel).toHaveBeenCalledWith('ollama', 'qwen2.5-coder:7b');
    await call('providers:setBaseUrl', { id: 'ollama', baseUrl: 'http://127.0.0.1:9999/v1' });
    expect(registry.setBaseUrl).toHaveBeenCalledWith('ollama', 'http://127.0.0.1:9999/v1');
  });

  it('skips a registry entry with no descriptor rather than rendering a broken row', async () => {
    // A downgrade past a provider the install once knew. The registry keeps the entry so an upgrade
    // restores it; the UI must not show it in the meantime.
    const { call } = await harness([
      { id: 'openrouter', enabled: true, model: '', baseUrl: '' },
      { id: 'provider-from-the-future', enabled: true, model: '', baseUrl: '' },
    ]);
    const { providers } = (await call('providers:list')) as { providers: { id: string }[] };
    expect(providers.map((p) => p.id)).toEqual(['openrouter']);
  });
});

/**
 * Per-provider credential isolation.
 *
 * The bug this replaces: `ai:setKey` writes `DEFAULT_PROVIDER_ID` — always OpenRouter — so a user
 * pasting a Gemini key overwrote their OpenRouter credential, and Gemini stayed unusable with no
 * indication anything had gone wrong. The credential store was always keyed per provider; only the
 * handler was not. These pin that a key now lands in exactly one slot and disturbs no other.
 */
describe('providers:setKey — a key lands in ONE slot', () => {
  it('saves to the named provider, not to OpenRouter', async () => {
    const { call, credentials } = await harness();
    await call('providers:setKey', { id: 'gemini', key: 'AIza-gemini-key' });
    expect(credentials.setKey).toHaveBeenCalledWith('gemini', 'AIza-gemini-key');
    expect(credentials.setKey).not.toHaveBeenCalledWith('openrouter', expect.anything());
  });

  it('does NOT overwrite another provider’s existing key', async () => {
    const { call, credentials, keys } = await harness();
    keys.set('openrouter', 'sk-or-existing');
    await call('providers:setKey', { id: 'gemini', key: 'AIza-new' });
    // The whole point of the fix.
    expect(keys.get('openrouter')).toBe('sk-or-existing');
    expect(keys.get('gemini')).toBe('AIza-new');
    expect(credentials.clearKey).not.toHaveBeenCalled();
  });

  it('enables the provider on save — a stored key that is never used is the same confusion inverted', async () => {
    const { call, registry } = await harness();
    await call('providers:setKey', { id: 'gemini', key: 'AIza-new' });
    expect(registry.setEnabled).toHaveBeenCalledWith('gemini', true);
  });

  it('does NOT reorder priority — that is a separate, deliberate decision', async () => {
    const { call, registry } = await harness();
    await call('providers:setKey', { id: 'gemini', key: 'AIza-new' });
    expect(registry.moveUp).not.toHaveBeenCalled();
    expect(registry.moveDown).not.toHaveBeenCalled();
  });

  it('cancels a run already issued against the PREVIOUS credential', async () => {
    // Otherwise the old key's verdict lands after the save and reads as the new key failing.
    const { call, onCredentialChange } = await harness();
    await call('providers:setKey', { id: 'gemini', key: 'AIza-new' });
    expect(onCredentialChange).toHaveBeenCalledTimes(1);
  });

  it('reports the masked hint back, never the key', async () => {
    // Explicit rows: the shared default has no gemini, and other tests assert its exact id list.
    const { call, keys } = await harness([
      { id: 'openrouter', enabled: true, model: '', baseUrl: '' },
      { id: 'gemini', enabled: true, model: '', baseUrl: '' },
    ]);
    keys.set('gemini', 'AIza-supersecret-tail');
    const { providers } = (await call('providers:list')) as {
      providers: { id: string; keyHint: string | null; hasKey: boolean }[];
    };
    const gemini = providers.find((p) => p.id === 'gemini');
    expect(gemini?.hasKey).toBe(true);
    expect(gemini?.keyHint).toBe('••••tail');
    expect(JSON.stringify(providers)).not.toContain('AIza-supersecret-tail');
  });
});

describe('providers:clearKey — removes ONE credential', () => {
  it('clears only the named provider', async () => {
    const { call, credentials, keys } = await harness();
    keys.set('openrouter', 'sk-or-keep');
    keys.set('gemini', 'AIza-drop');
    await call('providers:clearKey', { id: 'gemini' });
    expect(credentials.clearKey).toHaveBeenCalledWith('gemini');
    expect(keys.get('openrouter')).toBe('sk-or-keep');
    expect(keys.has('gemini')).toBe(false);
  });

  it('leaves the provider ENABLED — it simply has no key until one is supplied', async () => {
    // Flipping the switch off would hide that the user still intends to use it.
    const { call, registry } = await harness();
    await call('providers:clearKey', { id: 'gemini' });
    expect(registry.setEnabled).not.toHaveBeenCalledWith('gemini', false);
  });
});

/**
 * The primary field's save, and the bug behind "Set up AI to repair" over a configured provider.
 */
describe('providers:setKey — primary slot', () => {
  it('a NON-PRIMARY provider with a key counts as configured', async () => {
    // The reported bug. A key saved into any slot — not just the first — must make the app consider
    // AI set up; the chain tries every enabled, credentialed provider in order.
    const { call, keys } = await harness([
      { id: 'openrouter', enabled: true, model: '', baseUrl: '' },
      { id: 'gemini', enabled: false, model: '', baseUrl: '' },
    ]);
    await call('providers:setKey', { id: 'gemini', key: 'AIza-x' });

    expect(keys.get('gemini')).toBe('AIza-x');
    const { providers } = (await call('providers:list', {})) as {
      providers: { id: string; enabled: boolean; hasKey: boolean; priority: number }[];
    };
    const gemini = providers.find((p) => p.id === 'gemini');
    expect(gemini?.hasKey).toBe(true);
    // Enabled by the save, which is what makes it a candidate at all.
    expect(gemini?.enabled).toBe(true);
  });

  it('makePrimary moves the provider to the head of the chain', async () => {
    const { call } = await harness([
      { id: 'openrouter', enabled: true, model: '', baseUrl: '' },
      { id: 'openai', enabled: false, model: '', baseUrl: '' },
      { id: 'gemini', enabled: false, model: '', baseUrl: '' },
    ]);
    const { providers } = (await call('providers:setKey', {
      id: 'gemini',
      key: 'AIza-x',
      makePrimary: true,
    })) as {
      providers: { id: string; enabled: boolean; hasKey: boolean; priority: number }[];
    };
    expect(providers.map((p) => p.id)).toEqual(['gemini', 'openrouter', 'openai']);
    expect(providers[0]?.priority).toBe(1);
  });

  it('WITHOUT makePrimary the order is untouched — a named slot is not a priority claim', async () => {
    const { call } = await harness([
      { id: 'openrouter', enabled: true, model: '', baseUrl: '' },
      { id: 'gemini', enabled: false, model: '', baseUrl: '' },
    ]);
    const { providers } = (await call('providers:setKey', { id: 'gemini', key: 'AIza-x' })) as {
      providers: { id: string; enabled: boolean; hasKey: boolean; priority: number }[];
    };
    expect(providers.map((p) => p.id)).toEqual(['openrouter', 'gemini']);
  });
});
