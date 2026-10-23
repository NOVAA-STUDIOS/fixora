import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { BrowserWindow } from 'electron';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Orchestrator } from '../electron/main/ai/providers/orchestrator.js';
import type { SqliteDriver } from '../electron/main/db/driver.js';
import type * as FsService from '../electron/main/services/fs/fs-service.js';
import { loadIgnoreRules } from '../electron/main/services/fs/ignore-rules.js';
import type { WorkspaceService } from '../electron/main/services/workspace-service.js';
import { createZapprService } from '../electron/main/services/zappr-service.js';

const controls = vi.hoisted(() => ({
  failWritePath: null as string | null,
  failRestorePath: null as string | null,
  restoreCalls: [] as string[],
  afterWrite: null as ((path: string) => void) | null,
}));

vi.mock('../electron/main/db/repositories.js', () => ({
  createZapprConversationRepository: () => ({ recent: () => [], save: vi.fn() }),
}));

vi.mock('../electron/main/services/fs/fs-service.js', async (importOriginal) => {
  const actual = await importOriginal<typeof FsService>();
  return {
    ...actual,
    writeTextFile: (...args: Parameters<typeof actual.writeTextFile>) => {
      if (args[1] === controls.failWritePath) throw new Error('deterministic write failure');
      actual.writeTextFile(...args);
      controls.afterWrite?.(args[1]);
    },
    restoreWorkspaceFile: (...args: Parameters<typeof actual.restoreWorkspaceFile>) => {
      controls.restoreCalls.push(args[1].relPath);
      if (args[1].relPath === controls.failRestorePath) throw new Error('deterministic rollback failure');
      actual.restoreWorkspaceFile(...args);
    },
  };
});

const roots: string[] = [];

afterEach(() => {
  controls.failWritePath = null;
  controls.failRestorePath = null;
  controls.restoreCalls = [];
  controls.afterWrite = null;
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function setup(plan: object) {
  const rootPath = mkdtempSync(join(tmpdir(), 'fixora-zappr-rollback-'));
  roots.push(rootPath);
  const open = { id: 'workspace-1', rootPath, name: 'rollback-test', ignore: loadIgnoreRules(rootPath) };
  const events: { channel: string; payload: unknown }[] = [];
  const window = {
    isDestroyed: () => false,
    webContents: { send: (channel: string, payload: unknown) => events.push({ channel, payload }) },
  } as unknown as BrowserWindow;
  const raw = JSON.stringify(plan);
  const candidate = {
    provider: 'test',
    model: 'test',
    adapter: {
      stream: async function* () {
        await Promise.resolve();
        yield { type: 'text_delta' as const, text: raw };
      },
    },
  };
  const orchestrator = {
    run: async (_profile: unknown, execute: (value: typeof candidate) => Promise<unknown>) => execute(candidate),
  } as unknown as Orchestrator;
  const workspace = { getCurrent: () => open } as unknown as WorkspaceService;
  const service = createZapprService(orchestrator, workspace, window, {} as SqliteDriver);
  return { rootPath, events, service };
}

async function generateAndApprove(ctx: ReturnType<typeof setup>) {
  const runId = crypto.randomUUID();
  await ctx.service.run(runId, 'create files', null, [], null, null);
  const event = ctx.events.find(({ channel }) => channel === 'zappr:plan');
  return ctx.service.approvePlan((event?.payload as { approvalId: string }).approvalId, runId);
}

describe('Zappr plan rollback', () => {
  it('restores an earlier edit exactly when a later write fails', async () => {
    const ctx = setup({ summary: 'edit two', steps: [
      { type: 'edit', filePath: 'one.ts', description: 'first', content: 'changed' },
      { type: 'edit', filePath: 'fail.ts', description: 'fails', content: 'never' },
    ] });
    const original = Buffer.from([0xff, 0xfe, 0x61, 0x00, 0x0a, 0x00]);
    writeFileSync(join(ctx.rootPath, 'one.ts'), original);
    writeFileSync(join(ctx.rootPath, 'fail.ts'), 'before');
    controls.failWritePath = 'fail.ts';

    const result = await generateAndApprove(ctx);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Changes reverted after failure');
    expect(readFileSync(join(ctx.rootPath, 'one.ts'))).toEqual(original);
    expect(readFileSync(join(ctx.rootPath, 'fail.ts'), 'utf8')).toBe('before');
    expect(controls.restoreCalls).toEqual(['fail.ts', 'one.ts']);
  });

  it('removes created files and restores deleted files in reverse order', async () => {
    const ctx = setup({ summary: 'mixed', steps: [
      { type: 'create', filePath: 'created.ts', description: 'create', content: 'new' },
      { type: 'delete', filePath: 'deleted.ts', description: 'delete' },
      { type: 'edit', filePath: 'fail.ts', description: 'fails', content: 'never' },
      { type: 'create', filePath: 'later.ts', description: 'must not run', content: 'later' },
    ] });
    writeFileSync(join(ctx.rootPath, 'deleted.ts'), 'original deleted file');
    writeFileSync(join(ctx.rootPath, 'fail.ts'), 'before');
    controls.failWritePath = 'fail.ts';

    const result = await generateAndApprove(ctx);
    expect(result.ok).toBe(false);
    expect(existsSync(join(ctx.rootPath, 'created.ts'))).toBe(false);
    expect(readFileSync(join(ctx.rootPath, 'deleted.ts'), 'utf8')).toBe('original deleted file');
    expect(existsSync(join(ctx.rootPath, 'later.ts'))).toBe(false);
    expect(controls.restoreCalls).toEqual(['fail.ts', 'deleted.ts', 'created.ts']);
  });

  it('does not rollback a successful plan', async () => {
    const ctx = setup({ summary: 'success', steps: [
      { type: 'create', filePath: 'ok.ts', description: 'create', content: 'ok' },
    ] });
    expect((await generateAndApprove(ctx)).ok).toBe(true);
    expect(readFileSync(join(ctx.rootPath, 'ok.ts'), 'utf8')).toBe('ok');
    expect(controls.restoreCalls).toEqual([]);
  });

  it('rejects duplicate targets and directory deletion before mutation', async () => {
    const duplicate = setup({ summary: 'conflict', steps: [
      { type: 'create', filePath: 'same.ts', description: 'one', content: 'one' },
      { type: 'delete', filePath: 'same.ts', description: 'two' },
    ] });
    expect((await generateAndApprove(duplicate)).ok).toBe(false);
    expect(existsSync(join(duplicate.rootPath, 'same.ts'))).toBe(false);

    const directory = setup({ summary: 'directory', steps: [
      { type: 'create', filePath: 'before.ts', description: 'must not run', content: 'before' },
      { type: 'delete', filePath: 'folder', description: 'unsupported' },
    ] });
    mkdirSync(join(directory.rootPath, 'folder'));
    expect((await generateAndApprove(directory)).ok).toBe(false);
    expect(existsSync(join(directory.rootPath, 'before.ts'))).toBe(false);
    expect(existsSync(join(directory.rootPath, 'folder'))).toBe(true);
  });

  it('surfaces rollback failure and never emits success', async () => {
    const ctx = setup({ summary: 'rollback fails', steps: [
      { type: 'edit', filePath: 'one.ts', description: 'first', content: 'changed' },
      { type: 'edit', filePath: 'fail.ts', description: 'fails', content: 'never' },
    ] });
    writeFileSync(join(ctx.rootPath, 'one.ts'), 'original');
    writeFileSync(join(ctx.rootPath, 'fail.ts'), 'before');
    controls.failWritePath = 'fail.ts';
    controls.failRestorePath = 'one.ts';

    const result = await generateAndApprove(ctx);
    expect(result.error).toContain('Rollback incomplete');
    expect(result.error).toContain('Manual review required');
    const done = ctx.events.filter(({ channel }) => channel === 'zappr:done');
    expect(done.some(({ payload }) => (payload as { success: boolean }).success)).toBe(false);
  });

  it('rolls back completed steps when the exact run is cancelled during execution', async () => {
    const ctx = setup({ summary: 'cancel', steps: [
      { type: 'edit', filePath: 'one.ts', description: 'first', content: 'changed' },
      { type: 'create', filePath: 'later.ts', description: 'must not run', content: 'later' },
    ] });
    writeFileSync(join(ctx.rootPath, 'one.ts'), 'original');
    const runId = crypto.randomUUID();
    await ctx.service.run(runId, 'create files', null, [], null, null);
    const planEvent = ctx.events.find(({ channel }) => channel === 'zappr:plan');
    const approvalId = (planEvent?.payload as { approvalId: string }).approvalId;
    controls.afterWrite = (path) => {
      if (path === 'one.ts') ctx.service.cancel(runId);
    };

    const result = await ctx.service.approvePlan(approvalId, runId);
    expect(result.error).toContain('cancelled');
    expect(readFileSync(join(ctx.rootPath, 'one.ts'), 'utf8')).toBe('original');
    expect(existsSync(join(ctx.rootPath, 'later.ts'))).toBe(false);
    const done = ctx.events.filter(({ channel }) => channel === 'zappr:done');
    expect(done.some(({ payload }) => (payload as { success: boolean }).success)).toBe(false);
  });
});
