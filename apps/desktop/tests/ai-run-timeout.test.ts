import type { AiRunResponse } from '@fixora/shared-types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  BrowserWindow: { fromWebContents: vi.fn(() => null) },
  app: { getPath: () => '/tmp' },
}));

type Handler = (
  req: { profile: string; findingId: string },
  ctx: { requestId: string; window: null },
) => Promise<AiRunResponse>;

/**
 * ISSUE 6 (P0) regression: a repair could hang in "Running" forever.
 *
 * Root cause was the absence of any deadline in the Repair path. `ai:run` had no timeout, the service
 * had none, and the OpenRouter adapter calls `fetch` with a signal but no deadline — and Node's fetch
 * imposes no response timeout on a streaming body. A provider that accepted the connection and then
 * sent nothing left the SSE `for await` blocked, `ai:run`'s promise unresolved, and the renderer stuck
 * on `status: 'running'` with no way out. Proceed Mode had this guard since Q3; Repair never did.
 *
 * These drive the REAL handler with a service that never resolves, and prove the run still reaches
 * exactly one terminal state.
 */
async function runHandler(
  aiService: { run: () => Promise<AiRunResponse>; cancel: () => void },
  runTimeoutMs: number,
): Promise<Handler> {
  vi.resetModules();
  const { getHandler } = await import('../electron/main/ipc/router.js');
  const { registerAiHandlers } = await import('../electron/main/ipc/handlers/ai.handlers.js');
  registerAiHandlers({
    // The timeout report names the model on its status card, so the stub has to answer.
    keyStore: { getConfig: () => ({ model: 'test/model' }) } as never,
    credentials: { setKey: () => undefined, clearKey: () => undefined } as never,
    aiService: aiService as never,
    workspace: { getCurrent: () => null } as never,
    history: {} as never,
    catalogue: {} as never,
    runTimeoutMs,
  });
  return getHandler('ai:run') as unknown as Handler;
}

const REQUEST = { profile: 'repair', findingId: 'f1' };
const CTX = { requestId: 'r1', window: null };

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('ai:run — every run reaches a terminal state', () => {
  it('a run that never resolves is aborted and reported as timed out, not left running', async () => {
    // The exact hang: the service's promise only settles when something aborts it.
    let abort: (() => void) | null = null;
    const aiService = {
      run: () =>
        new Promise<AiRunResponse>((resolve) => {
          abort = () => resolve({ status: 'error', code: 'cancelled', message: 'Cancelled.' });
        }),
      cancel: vi.fn(() => abort?.()),
    };

    const handler = await runHandler(aiService, 1000);
    const pending = handler(REQUEST, CTX);

    await vi.advanceTimersByTimeAsync(1001);
    const outcome = await pending;

    expect(aiService.cancel).toHaveBeenCalledTimes(1); // background work was actually stopped
    expect(outcome.status).toBe('error');
    if (outcome.status === 'error') {
      // Retagged from `cancelled`: the user did not cancel this, so saying so would be a lie.
      expect(outcome.code).toBe('timeout');
      expect(outcome.message).toMatch(/took longer than 1 seconds?/i);
      expect(outcome.message).toMatch(/nothing was changed/i);
      expect(outcome.retryable).toBe(true);
      expect(outcome.message.toLowerCase()).not.toContain('cancelled');
    }
  });

  it('a genuine user cancellation is still reported as cancelled, never as a timeout', async () => {
    const aiService = {
      run: () =>
        Promise.resolve<AiRunResponse>({
          status: 'error',
          code: 'cancelled',
          message: 'Cancelled.',
        }),
      cancel: vi.fn(),
    };
    const handler = await runHandler(aiService, 60_000);
    const outcome = await handler(REQUEST, CTX);
    expect(outcome.status).toBe('error');
    // The timer never fired, so the `cancelled` code must survive untouched.
    if (outcome.status === 'error') expect(outcome.code).toBe('cancelled');
  });

  it('a fast successful run is unaffected and the timer never fires', async () => {
    const aiService = {
      run: () =>
        Promise.resolve<AiRunResponse>({
          status: 'error',
          code: 'no_key',
          message: 'Add your provider key in Settings → AI.',
        }),
      cancel: vi.fn(),
    };
    const handler = await runHandler(aiService, 60_000);
    const outcome = await handler(REQUEST, CTX);
    if (outcome.status === 'error') expect(outcome.code).toBe('no_key');
    await vi.advanceTimersByTimeAsync(120_000);
    // The `finally` disarmed it — a stale timer would abort a LATER, unrelated run.
    expect(aiService.cancel).not.toHaveBeenCalled();
  });

  it('a thrown error still returns a typed value rather than hanging or escaping', async () => {
    const aiService = {
      run: () => Promise.reject(new Error('worker died')),
      cancel: vi.fn(),
    };
    const handler = await runHandler(aiService, 60_000);
    const outcome = await handler(REQUEST, CTX);
    expect(outcome.status).toBe('error');
    if (outcome.status === 'error') {
      expect(outcome.code).toBe('internal_error');
      expect(outcome.message).toContain('worker died');
    }
  });
});
