import type { BulkRepairFlushResult } from '@fixora/shared-types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  BrowserWindow: { fromWebContents: vi.fn(() => null) },
}));

/**
 * `ai:bulkRepairStart` / `ai:bulkRepairFlush` — the IPC pair "Repair All" uses to defer the repair-
 * history writes `ai:applyRepair` would otherwise make one at a time. These assert the WIRING (each
 * channel calls the right repository method, with the right argument, and returns the right shape);
 * `createRepairHistoryRepository`'s own buffer/replay-in-one-transaction logic is exercised directly
 * against a real driver by its own unit test.
 */

type Ctx = { requestId: string; window: null };
type StartHandler = (req: { workspaceId: string }, ctx: Ctx) => Promise<void> | void;
type FlushHandler = (req: { workspaceId: string }, ctx: Ctx) => Promise<BulkRepairFlushResult>;

async function handlers(history: {
  beginBulk: () => void;
  flush: () => number;
}): Promise<{ start: StartHandler; flush: FlushHandler }> {
  vi.resetModules();
  const { getHandler } = await import('../electron/main/ipc/router.js');
  const { registerAiHandlers } = await import('../electron/main/ipc/handlers/ai.handlers.js');
  registerAiHandlers({
    keyStore: {} as never,
    credentials: { setKey: () => undefined, clearKey: () => undefined } as never,
    registry: { enabled: () => [] } as never,
    aiService: { run: vi.fn(), cancel: vi.fn() },
    workspace: { getCurrent: () => null } as never,
    history: {
      markApplied: vi.fn(),
      record: vi.fn(),
      list: () => [],
      getByFile: () => [],
      getStatsToday: () => ({ repairedToday: 0, repairedTotal: 0, filesFixed: 0 }),
      remove: vi.fn(),
      clearWorkspace: vi.fn(),
      beginBulk: history.beginBulk,
      flush: history.flush,
    },
    catalogue: {} as never,
  });
  return {
    start: getHandler('ai:bulkRepairStart') as unknown as StartHandler,
    flush: getHandler('ai:bulkRepairFlush') as unknown as FlushHandler,
  };
}

const ctx: Ctx = { requestId: 'r1', window: null };

describe('ai:bulkRepairStart / ai:bulkRepairFlush', () => {
  let beginBulk: ReturnType<typeof vi.fn<() => void>>;
  let flush: ReturnType<typeof vi.fn<() => number>>;

  beforeEach(() => {
    beginBulk = vi.fn<() => void>();
    flush = vi.fn<() => number>(() => 0);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('ai:bulkRepairStart arms the buffer via the repository', async () => {
    const { start } = await handlers({ beginBulk, flush });
    await start({ workspaceId: 'ws1' }, ctx);
    expect(beginBulk).toHaveBeenCalledTimes(1);
  });

  it('ai:bulkRepairFlush commits the buffer and reports the count', async () => {
    flush = vi.fn<() => number>(() => 3);
    const { flush: flushHandler } = await handlers({ beginBulk, flush });
    const result = await flushHandler({ workspaceId: 'ws1' }, ctx);
    expect(flush).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ flushed: 3 });
  });

  it('ai:bulkRepairFlush reports zero when nothing was buffered — not an error', async () => {
    const { flush: flushHandler } = await handlers({ beginBulk, flush });
    const result = await flushHandler({ workspaceId: 'ws1' }, ctx);
    expect(result).toEqual({ flushed: 0 });
  });
});
