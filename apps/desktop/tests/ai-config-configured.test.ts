import { describe, expect, it, vi } from 'vitest';

/**
 * `configured` must come from the REGISTRY on every channel that returns a config.
 *
 * This broke twice for the same structural reason. `StoredAiConfig.configured` is hardcoded false —
 * the v1 store it comes from holds no credential any more — and each config-returning channel is
 * expected to override it with `anyProviderConfigured`. `ai:getConfig` does not call `enrich()`; it
 * has its own two return paths, and reached neither override. It is also the channel the panels read
 * on mount, so a user with a working key was told to "Set up AI to repair" on every launch, and no
 * refresh could correct it: the value was false by construction, not stale.
 *
 * Both of that handler's paths are covered here, including the one taken when the model catalogue is
 * unreachable — being offline says nothing about whether a provider is configured.
 */
type Handler = (payload: unknown) => Promise<{ configured: boolean }>;

async function getConfigHandler(options: {
  enabled: { id: string; enabled: boolean; model: string; baseUrl: string }[];
  keys: Record<string, string>;
  catalogueWorks: boolean;
}): Promise<Handler> {
  vi.resetModules();
  const { getHandler } = await import('../electron/main/ipc/router.js');
  const { registerAiHandlers } = await import('../electron/main/ipc/handlers/ai.handlers.js');

  const catalogue = options.catalogueWorks
    ? {
        resolve: (model: string) => Promise.resolve({ model, migratedFrom: null }),
        list: () => Promise.resolve({ models: [], notice: null }),
      }
    : {
        resolve: () => Promise.reject(new Error('offline')),
        list: () => Promise.reject(new Error('offline')),
      };

  registerAiHandlers({
    keyStore: { getConfig: () => ({ configured: false, model: 'm', keyHint: null, migratedFrom: null }) } as never,
    credentials: { getKey: (id: string) => options.keys[id] ?? null } as never,
    registry: { enabled: () => options.enabled } as never,
    aiService: { run: () => Promise.resolve({}), cancel: () => undefined } as never,
    workspace: { getCurrent: () => null } as never,
    history: {} as never,
    catalogue: catalogue as never,
  });
  return getHandler('ai:getConfig') as unknown as Handler;
}

const GEMINI = [{ id: 'gemini', enabled: true, model: '', baseUrl: '' }];

describe('ai:getConfig — configured comes from the registry', () => {
  it('reports CONFIGURED for a keyed, enabled provider that is not OpenRouter', async () => {
    // The reported bug, exactly: fresh install, Gemini key saved, panel still said "set up AI".
    const handler = await getConfigHandler({
      enabled: GEMINI,
      keys: { gemini: 'AIza-x' },
      catalogueWorks: true,
    });
    expect((await handler({})).configured).toBe(true);
  });

  it('still reports configured when the model catalogue is unreachable', async () => {
    // The second return path. Being offline says nothing about whether a provider is set up, and
    // reporting "not configured" because OpenRouter was down is the same lie in a different costume.
    const handler = await getConfigHandler({
      enabled: GEMINI,
      keys: { gemini: 'AIza-x' },
      catalogueWorks: false,
    });
    expect((await handler({})).configured).toBe(true);
  });

  it('reports NOT configured on a genuinely fresh install', async () => {
    const handler = await getConfigHandler({ enabled: [], keys: {}, catalogueWorks: true });
    expect((await handler({})).configured).toBe(false);
  });

  it('reports NOT configured when a provider is enabled but has no key', async () => {
    const handler = await getConfigHandler({ enabled: GEMINI, keys: {}, catalogueWorks: true });
    expect((await handler({})).configured).toBe(false);
  });

  it('never simply passes through the stored flag, which is always false', async () => {
    // If this ever fails, a return path lost its override and the bug is back.
    const handler = await getConfigHandler({
      enabled: GEMINI,
      keys: { gemini: 'AIza-x' },
      catalogueWorks: true,
    });
    const config = await handler({});
    expect(config.configured).not.toBe(false);
  });
});
