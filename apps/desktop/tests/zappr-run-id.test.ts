import type { BrowserWindow } from 'electron';
import { describe, expect, it, vi } from 'vitest';

import type { Orchestrator } from '../electron/main/ai/providers/orchestrator.js';
import type { SqliteDriver } from '../electron/main/db/driver.js';
import type { WorkspaceService } from '../electron/main/services/workspace-service.js';
import { createZapprService } from '../electron/main/services/zappr-service.js';

vi.mock('../electron/main/db/repositories.js', () => ({
  createZapprConversationRepository: () => ({ recent: () => [], save: vi.fn() }),
}));

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let i = 0; i < 20; i++) {
    if (predicate()) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  throw new Error('Timed out waiting for provider state.');
}

describe('Zappr run identity and cancellation', () => {
  it('aborts only the targeted active controller and never emits cancelled success', async () => {
    const signals: AbortSignal[] = [];
    const events: { channel: string; payload: unknown }[] = [];
    const candidate = {
      provider: 'test',
      model: 'test',
      adapter: {
        stream: async function* (_request: unknown, signal: AbortSignal) {
          signals.push(signal);
          await new Promise<void>((resolve) => {
            signal.addEventListener('abort', () => { resolve(); }, { once: true });
          });
          yield { type: 'text_delta' as const, text: 'late' };
        },
      },
    };
    const orchestrator = {
      run: async (_profile: unknown, execute: (value: typeof candidate) => Promise<unknown>) => execute(candidate),
    } as unknown as Orchestrator;
    const window = {
      isDestroyed: () => false,
      webContents: { send: (channel: string, payload: unknown) => events.push({ channel, payload }) },
    } as unknown as BrowserWindow;
    const workspace = { getCurrent: () => null } as unknown as WorkspaceService;
    const service = createZapprService(orchestrator, workspace, window, {} as SqliteDriver);
    const runA = crypto.randomUUID();
    const runB = crypto.randomUUID();

    const promiseA = service.run(runA, 'explain A', null, [], null, null);
    await waitFor(() => signals.length === 1);
    const promiseB = service.run(runB, 'explain B', null, [], null, null);
    await waitFor(() => signals.length === 2);
    expect(signals[0]?.aborted).toBe(true);
    expect(signals[1]?.aborted).toBe(false);

    service.cancel(runA);
    service.cancel(runA);
    expect(signals[1]?.aborted).toBe(false);
    service.cancel(runB);
    expect(signals[1]?.aborted).toBe(true);
    await Promise.all([promiseA, promiseB]);

    expect(events.every(({ payload }) => typeof (payload as { runId?: unknown }).runId === 'string')).toBe(true);
    expect(events.some(({ payload }) => {
      const event = payload as { runId?: string; success?: boolean };
      return event.runId === runB && event.success === true;
    })).toBe(false);
  });
});
