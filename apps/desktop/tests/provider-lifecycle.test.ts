import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * Provider-lifecycle regression, main-process half.
 *
 * `ai:setKey` wrote only the v1 `keyStore`, while the orchestrator builds every provider from
 * `credentials.getKey(id)` (`orchestrator.ts:118`) — the v2 store. The new key therefore never
 * reached the store the provider is actually made from. And because the v2 store only adopts the v1
 * file when its OWN file is absent (`credential-store.ts` → `migrateLegacy`), restarting did not
 * repair it either: that is the "even after restarting" half of the report.
 *
 * These pin the invariant that fixes it — a saved key lands in BOTH stores, and any run belonging to
 * the previous credential is aborted so its result cannot be read as the new key failing.
 */

type Handler = (payload: unknown) => Promise<unknown>;

async function handlers(spies: {
  credSet: ReturnType<typeof vi.fn>;
  credClear: ReturnType<typeof vi.fn>;
  keySet: ReturnType<typeof vi.fn>;
  keyModel: ReturnType<typeof vi.fn>;
  keyClear: ReturnType<typeof vi.fn>;
  cancel: ReturnType<typeof vi.fn>;
}) {
  vi.resetModules();
  const { getHandler } = await import('../electron/main/ipc/router.js');
  const { registerAiHandlers } = await import('../electron/main/ipc/handlers/ai.handlers.js');
  const config = { configured: true, model: 'm', keyHint: '••••', migratedFrom: null };
  registerAiHandlers({
    keyStore: {
      setKey: spies.keySet.mockReturnValue(config),
      clearKey: spies.keyClear.mockReturnValue({ ...config, configured: false }),
      setModel: spies.keyModel.mockReturnValue(config),
      getConfig: () => config,
    } as never,
    credentials: { setKey: spies.credSet, clearKey: spies.credClear } as never,
    registry: { enabled: () => [] } as never,
    aiService: { run: vi.fn(), cancel: spies.cancel } as never,
    workspace: {} as never,
    history: {} as never,
    // No catalogue: `enrich` falls into its catch and reports unknown capability, which is fine here.
    catalogue: { list: () => Promise.reject(new Error('offline')) } as never,
  });
  return {
    setKey: getHandler('ai:setKey') as unknown as Handler,
    clearKey: getHandler('ai:clearKey') as unknown as Handler,
    setModel: getHandler('ai:setModel') as unknown as Handler,
  };
}

function spies() {
  return {
    credSet: vi.fn(),
    credClear: vi.fn(),
    keySet: vi.fn(),
    keyModel: vi.fn(),
    keyClear: vi.fn(),
    cancel: vi.fn(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ai:setKey — the key reaches the store the provider is built from', () => {
  it('writes the credential store, not only the legacy key store', async () => {
    const s = spies();
    const { setKey } = await handlers(s);
    await setKey({ key: 'sk-new-valid' });

    // The store `orchestrator.ts` reads. Without this the old key survived every save.
    expect(s.credSet).toHaveBeenCalledWith('openrouter', 'sk-new-valid');
    // And the legacy store, which still backs the renderer's config and the downgrade path.
    expect(s.keySet).toHaveBeenCalledWith('sk-new-valid', undefined);
  });

  it('aborts any run still in flight, so the old key cannot report after the switch', async () => {
    const s = spies();
    const { setKey } = await handlers(s);
    await setKey({ key: 'sk-new-valid' });
    expect(s.cancel).toHaveBeenCalledTimes(1);
  });

  it('writes the credential store BEFORE the legacy one, so a keychain failure leaves neither', async () => {
    const s = spies();
    s.credSet.mockImplementation(() => {
      throw new Error('keychain unavailable');
    });
    const { setKey } = await handlers(s);
    await expect(setKey({ key: 'sk-new' })).rejects.toThrow(/keychain/i);
    // The authoritative store threw, so the legacy store must not have been written — the two can
    // never end up disagreeing with a failure shown to the user.
    expect(s.keySet).not.toHaveBeenCalled();
  });

  it('carries the model through when Save changes both at once', async () => {
    const s = spies();
    const { setKey } = await handlers(s);
    await setKey({ key: 'sk-new', model: 'other/model' });
    expect(s.credSet).toHaveBeenCalledWith('openrouter', 'sk-new');
    expect(s.keySet).toHaveBeenCalledWith('sk-new', 'other/model');
  });

  it('multiple saves each reach the credential store — the last key wins', async () => {
    const s = spies();
    const { setKey } = await handlers(s);
    await setKey({ key: 'sk-1' });
    await setKey({ key: 'sk-2' });
    await setKey({ key: 'sk-3' });
    expect(s.credSet).toHaveBeenCalledTimes(3);
    expect(s.credSet).toHaveBeenLastCalledWith('openrouter', 'sk-3');
    expect(s.cancel).toHaveBeenCalledTimes(3);
  });
});

describe('ai:clearKey — removal reaches both stores', () => {
  it('clears the credential store as well as the legacy one, and cancels in-flight work', async () => {
    const s = spies();
    const { clearKey } = await handlers(s);
    await clearKey({});
    expect(s.credClear).toHaveBeenCalledWith('openrouter');
    expect(s.keyClear).toHaveBeenCalledTimes(1);
    expect(s.cancel).toHaveBeenCalledTimes(1);
  });
});

describe('ai:setModel — a model switch is a provider change too', () => {
  it('aborts the run in flight, which was issued against the PREVIOUS model', async () => {
    const s = spies();
    const { setModel } = await handlers(s);
    await setModel({ model: 'other/model' });
    // Without this the old model's verdict — a quota refusal, say — lands after the switch and is
    // read as the newly chosen model refusing.
    expect(s.cancel).toHaveBeenCalledTimes(1);
    expect(s.keyModel).toHaveBeenCalledWith('other/model');
  });
});

/**
 * Removal is permanent — including across a restart.
 *
 * The v1 file is not only the downgrade path, it is the RESURRECTION path: `credential-store.ts`'s
 * `migrateLegacy` adopts the v1 key whenever the v2 file is absent or unreadable. So "Remove Key"
 * has to clear both stores, and a failure in one must not leave the other holding the key — a
 * removal that cleared v2 and then threw would look successful and hand the key back on the next
 * launch that could not read v2.
 */
describe('ai:clearKey — removal is authoritative and survives restart', () => {
  it('clears BOTH the provider store and the legacy file', async () => {
    const s = spies();
    const { clearKey } = await handlers(s);
    await clearKey({});
    // The store the provider is built from.
    expect(s.credClear).toHaveBeenCalledWith('openrouter');
    // The store `migrateLegacy` would otherwise resurrect from.
    expect(s.keyClear).toHaveBeenCalledTimes(1);
  });

  it('still clears the LEGACY file when the provider store throws', async () => {
    // Otherwise the next launch that cannot read v2 migrates the deleted key straight back.
    const s = spies();
    s.credClear.mockImplementation(() => {
      throw new Error('keychain unavailable');
    });
    const { clearKey } = await handlers(s);
    await expect(clearKey({})).rejects.toThrow(/keychain/i);
    expect(s.keyClear).toHaveBeenCalledTimes(1);
  });

  it('still clears the PROVIDER store when the legacy file throws', async () => {
    const s = spies();
    const { clearKey } = await handlers(s);
    // Set AFTER wiring: the harness assigns a return value to this spy while registering handlers.
    s.keyClear.mockImplementation(() => {
      throw new Error('disk full');
    });
    await expect(clearKey({})).rejects.toThrow();
    expect(s.credClear).toHaveBeenCalledWith('openrouter');
  });

  it('reports the failure rather than returning a config that claims success', async () => {
    const s = spies();
    s.credClear.mockImplementation(() => {
      throw new Error('keychain unavailable');
    });
    const { clearKey } = await handlers(s);
    // A silent success here would tell the user the key is gone while it is still on disk.
    await expect(clearKey({})).rejects.toThrow();
  });

  it('aborts any run still in flight, so the removed key cannot report afterwards', async () => {
    const s = spies();
    const { clearKey } = await handlers(s);
    await clearKey({});
    expect(s.cancel).toHaveBeenCalledTimes(1);
  });
});
