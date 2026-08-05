import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ProceedOutcome, ProceedRunRequest } from '@fixora/shared-types';
import { UserFacingError } from '@fixora/shared-types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fakeOrchestrator } from './support/fake-orchestrator.js';

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  BrowserWindow: { fromWebContents: vi.fn(() => null) },
}));

type Handler = (
  req: ProceedRunRequest,
  ctx: { requestId: string; window: null },
) => Promise<ProceedOutcome>;

/**
 * Audit A6 remediation, B2: `proceed:run`'s catch-all used to return `error.message` verbatim — a raw
 * JS error (or, worse, a stack-trace fragment) reaching the renderer instead of Repair's actionable,
 * non-generic wording. These drive the REAL handler (no Electron, real temp workspace) against a
 * `host.resolveScope` that fails, exactly the way a worker crash reaches this catch block in production.
 */
async function proceedHandler(
  root: string,
  overrides: { host?: { resolveScope: (job: { onError: (message: string) => void }) => void } } = {},
): Promise<Handler> {
  vi.resetModules();
  const { getHandler } = await import('../electron/main/ipc/router.js');
  const { registerProceedHandlers } = await import(
    '../electron/main/ipc/handlers/proceed.handlers.js'
  );
  registerProceedHandlers({
    keyStore: {
      getKey: () => 'fake-key',
      getConfig: () => ({ model: 'test-model' }),
    } as never,
    workspace: { getCurrent: () => ({ id: 'ws-1', rootPath: root, name: 'p', ignore: [] }) } as never,
    findings: { list: () => [] } as never,
    verification: { verify: vi.fn() } as never,
    // Provider selection now comes from the orchestrator. These tests never reach a provider call —
    // they exercise the scope-worker failure paths — but the chain must resolve for the handler to
    // get that far, so a single stub candidate stands in.
    orchestrator: fakeOrchestrator([
      {
        provider: 'openrouter',
        model: 'test-model',
        adapter: {
          id: 'stub',
          capabilities: { structuredOutput: true, maxContext: 100_000 },
          stream: () =>
            (async function* () {
              yield { type: 'text_delta' as const, text: '' };
            })(),
          test: () =>
            Promise.resolve({
              reachable: true,
              authenticated: true,
              modelAvailable: true,
              latencyMs: 1,
            }),
        },
      },
    ]),
    history: { record: vi.fn(() => 'history-1'), markApplied: vi.fn() } as never,
    host: (overrides.host ?? {
      resolveScope: (job: { onError: (message: string) => void }) => {
        job.onError('scope worker crashed');
      },
    }) as never,
  });
  return getHandler('proceed:run') as unknown as Handler;
}

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'fx-proceed-'));
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'src', 'a.ts'), 'export function a() {\n  return 1;\n}\n');
});
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

describe('proceed:run — unhandled exceptions never reach the renderer as raw errors', () => {
  it('B2: a worker crash is reported via the same actionable wording as Repair, not a raw error message', async () => {
    const handler = await proceedHandler(root);
    const outcome = await handler(
      { instruction: 'rename this variable', file: 'src/a.ts', selectionStartLine: 2 },
      { requestId: 'r1', window: null },
    );
    expect(outcome.status).toBe('error');
    if (outcome.status === 'error') {
      expect(outcome.message).toContain('Fixora could not finish this edit');
      expect(outcome.message).toContain('scope worker crashed'); // the real detail, never hidden
      expect(outcome.message.toLowerCase()).toContain('report');
      expect(outcome.message.toLowerCase()).not.toContain('internal error');
      expect(outcome.message.toLowerCase()).not.toContain('unknown error');
    }
  });

  it('B2: an authored UserFacingError still surfaces verbatim, not wrapped in the generic bug sentence', async () => {
    const handler = await proceedHandler(root, {
      host: {
        resolveScope: () => {
          throw new UserFacingError('This file is locked by another program. Close it and retry.', {
            code: 'fs_busy',
          });
        },
      },
    });
    const outcome = await handler(
      { instruction: 'rename this variable', file: 'src/a.ts', selectionStartLine: 2 },
      { requestId: 'r2', window: null },
    );
    expect(outcome.status).toBe('error');
    if (outcome.status === 'error') {
      expect(outcome.message).toBe('This file is locked by another program. Close it and retry.');
      expect(outcome.message).not.toContain('Fixora could not finish');
    }
  });
});
