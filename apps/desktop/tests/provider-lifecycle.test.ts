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
