import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Handler } from '../electron/main/ipc/router.js';

/**
 * Red-team of the one channel that writes to the user's disk (Beta Phase F). The renderer is hostile
 * (invariant I1); `ai:applyRepair` must not be a way to write outside the workspace, over a secret, or
 * to splice a stale range into a file that changed. Each case drives the REAL handler through a fresh
 * registry against a real temp workspace.
 */

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'fixora-apply-rt-'));
  mkdirSync(join(dir, 'src'), { recursive: true });
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

interface Harness {
  handler: Handler<'ai:applyRepair'>;
  appliedId: () => string | null;
}

async function applyHandler(): Promise<Harness> {
  vi.resetModules();
  const router = await import('../electron/main/ipc/router.js');
  const { registerAiHandlers } = await import('../electron/main/ipc/handlers/ai.handlers.js');
  let applied: string | null = null;
  registerAiHandlers({
    keyStore: {} as never,
    credentials: { setKey: () => undefined, clearKey: () => undefined } as never,
    registry: { enabled: () => [] } as never,
    aiService: {} as never,
    catalogue: {} as never,
    workspace: { getCurrent: () => ({ id: 'ws', rootPath: dir, name: 'x' }) } as never,
    history: {
      markApplied: (id: string) => {
        applied = id;
      },
    } as never,
  });
  const handler = router.getHandler('ai:applyRepair');
  if (handler === undefined) throw new Error('handler not registered');
  return { handler, appliedId: () => applied };
}

const ctx = { requestId: 'r1', window: null };

describe('ai:applyRepair red-team (the renderer is hostile)', () => {
  it('refuses a path-traversal target — cannot write outside the workspace', async () => {
    const { handler } = await applyHandler();
    expect(() =>
      handler(
        { file: '../../evil.txt', startLine: 1, endLine: 1, code: 'x', expectedOriginal: '' },
        ctx,
      ),
    ).toThrow();
  });

  it('refuses to write over a secrets-denylisted path (.env)', async () => {
    writeFileSync(join(dir, '.env'), 'SECRET=1\n');
    const { handler } = await applyHandler();
    expect(() =>
      handler(
        { file: '.env', startLine: 1, endLine: 1, code: 'HACKED=1', expectedOriginal: 'SECRET=1' },
        ctx,
      ),
    ).toThrow();
    // The secret file is untouched.
    expect(readFileSync(join(dir, '.env'), 'utf8')).toBe('SECRET=1\n');
  });

  it('refuses a stale apply when the file changed since the proposal', async () => {
    writeFileSync(join(dir, 'src', 'a.ts'), 'const a = 1;\nconst b = 2;\n');
    const { handler } = await applyHandler();

    // The refusal is a *value* now, not a throw: the router redacts thrown messages, so an expected
    // and actionable condition has to travel as contract data or the user is told nothing useful.
    // The security property under test is unchanged and still asserted below — no write happens.
    const outcome = await handler(
      {
        file: 'src/a.ts',
        startLine: 1,
        endLine: 1,
        code: 'const a = 999;',
        expectedOriginal: 'const a = OLD;', // does not match the current line 1
      },
      ctx,
    );

    expect(outcome.applied).toBe(false);
    expect(outcome.applied === false && outcome.reason).toBe('stale-range');
    expect(outcome.applied === false && outcome.message).toMatch(/changed/i);
    // The evidence behind the refusal is reported, not merely asserted.
    expect(outcome.staleRangeCheck?.passed).toBe(false);
    expect(outcome.staleRangeCheck?.expectedHash).not.toBe(outcome.staleRangeCheck?.actualHash);
    // THE INVARIANT, unchanged: the file is left exactly as it was.
    expect(readFileSync(join(dir, 'src', 'a.ts'), 'utf8')).toBe('const a = 1;\nconst b = 2;\n');
  });

  it('applies a fresh repair whose expected original still matches, and marks history applied', async () => {
    writeFileSync(join(dir, 'src', 'a.ts'), 'const a = 1;\nconst b = 2;\n');
    const { handler, appliedId } = await applyHandler();
    await handler(
      {
        file: 'src/a.ts',
        startLine: 1,
        endLine: 1,
        code: 'const a = 42;',
        expectedOriginal: 'const a = 1;',
        historyId: 'h1',
      },
      ctx,
    );
    expect(readFileSync(join(dir, 'src', 'a.ts'), 'utf8')).toBe('const a = 42;\nconst b = 2;\n');
    expect(appliedId()).toBe('h1');
  });
});
