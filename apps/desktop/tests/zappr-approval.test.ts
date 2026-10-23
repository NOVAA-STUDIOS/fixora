import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { BrowserWindow } from 'electron';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Orchestrator } from '../electron/main/ai/providers/orchestrator.js';
import type { SqliteDriver } from '../electron/main/db/driver.js';
import { loadIgnoreRules } from '../electron/main/services/fs/ignore-rules.js';
import type { WorkspaceService } from '../electron/main/services/workspace-service.js';
import { createZapprService } from '../electron/main/services/zappr-service.js';

vi.mock('../electron/main/db/repositories.js', () => ({
  createZapprConversationRepository: () => ({ recent: () => [], save: vi.fn() }),
}));

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function setup(plan: object) {
  const rootPath = mkdtempSync(join(tmpdir(), 'fixora-zappr-approval-'));
  roots.push(rootPath);
  let current = {
    id: 'workspace-1',
    rootPath,
    name: 'approval-test',
    ignore: loadIgnoreRules(rootPath),
  };
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
  const workspace = { getCurrent: () => current } as unknown as WorkspaceService;
  const service = createZapprService(orchestrator, workspace, window, {} as SqliteDriver);
  return {
    rootPath,
    events,
    service,
    changeWorkspace: () => {
      current = { ...current, id: 'workspace-2' };
    },
  };
}

function approvalFrom(events: { channel: string; payload: unknown }[]): { approvalId: string; runId: string } {
  const event = events.find(({ channel }) => channel === 'zappr:plan');
  expect(event).toBeDefined();
  return event?.payload as { approvalId: string; runId: string };
}

describe('Zappr plan approval', () => {
  it('does not write until approval, then executes the main-stored plan once', async () => {
    const ctx = setup({
      summary: 'create nested file',
      steps: [{ type: 'create', filePath: 'src/generated.ts', description: 'create it', content: 'original' }],
    });

    const runId = crypto.randomUUID();
    await expect(ctx.service.run(runId, 'create a file', null, [], null, null)).resolves.toEqual({ ok: true });
    expect(existsSync(join(ctx.rootPath, 'src', 'generated.ts'))).toBe(false);
    const { approvalId } = approvalFrom(ctx.events);
    expect(ctx.events.filter(({ channel }) => channel.startsWith('zappr:')).every(({ payload }) =>
      (payload as { runId?: string }).runId === runId)).toBe(true);

    await expect(ctx.service.approvePlan(approvalId, runId)).resolves.toEqual({ ok: true });
    expect(readFileSync(join(ctx.rootPath, 'src', 'generated.ts'), 'utf8')).toBe('original');
    expect((await ctx.service.approvePlan(approvalId, runId)).ok).toBe(false);
  });

  it('rejects without executing create or delete and removes the pending plan', async () => {
    const ctx = setup({
      summary: 'mixed plan',
      steps: [
        { type: 'create', filePath: 'new.ts', description: 'create', content: 'new' },
        { type: 'delete', filePath: 'old.ts', description: 'delete' },
      ],
    });
    writeFileSync(join(ctx.rootPath, 'old.ts'), 'old');
    const runId = crypto.randomUUID();
    await ctx.service.run(runId, 'create files', null, [], null, null);
    const { approvalId } = approvalFrom(ctx.events);

    expect(ctx.service.rejectPlan(approvalId, runId)).toEqual({ ok: true });
    expect(existsSync(join(ctx.rootPath, 'new.ts'))).toBe(false);
    expect(readFileSync(join(ctx.rootPath, 'old.ts'), 'utf8')).toBe('old');
    expect((await ctx.service.approvePlan(approvalId, runId)).ok).toBe(false);
  });

  it('fails safely for unknown ids and workspace changes', async () => {
    const ctx = setup({
      summary: 'create file',
      steps: [{ type: 'create', filePath: 'safe.ts', description: 'create', content: 'safe' }],
    });
    const runId = crypto.randomUUID();
    expect((await ctx.service.approvePlan(crypto.randomUUID(), runId)).ok).toBe(false);
    await ctx.service.run(runId, 'create a file', null, [], null, null);
    const { approvalId } = approvalFrom(ctx.events);
    expect((await ctx.service.approvePlan(approvalId, crypto.randomUUID())).ok).toBe(false);
    expect(existsSync(join(ctx.rootPath, 'safe.ts'))).toBe(false);
    ctx.changeWorkspace();

    expect((await ctx.service.approvePlan(approvalId, runId)).ok).toBe(false);
    expect(existsSync(join(ctx.rootPath, 'safe.ts'))).toBe(false);
    expect((await ctx.service.approvePlan(approvalId, runId)).ok).toBe(false);
  });

  it('cancellation and a newer run invalidate older approvals', async () => {
    const ctx = setup({
      summary: 'create file',
      steps: [{ type: 'create', filePath: 'safe.ts', description: 'create', content: 'safe' }],
    });
    const cancelledRunId = crypto.randomUUID();
    await ctx.service.run(cancelledRunId, 'create a file', null, [], null, null);
    const cancelledId = approvalFrom(ctx.events).approvalId;
    ctx.service.cancel(cancelledRunId);
    expect((await ctx.service.approvePlan(cancelledId, cancelledRunId)).ok).toBe(false);

    const firstRunId = crypto.randomUUID();
    await ctx.service.run(firstRunId, 'create a file', null, [], null, null);
    const firstId = approvalFrom(ctx.events.slice().reverse()).approvalId;
    await ctx.service.run(crypto.randomUUID(), 'create another file', null, [], null, null);
    expect((await ctx.service.approvePlan(firstId, firstRunId)).ok).toBe(false);
  });

  it('leaves chat and review modes outside the approval flow', async () => {
    const ctx = setup({ summary: 'plain response', steps: [] });
    expect((await ctx.service.run(crypto.randomUUID(), 'explain this code', null, [], null, null)).ok).toBe(true);
    expect(ctx.events.some(({ channel }) => channel === 'zappr:plan')).toBe(false);

    writeFileSync(join(ctx.rootPath, 'review.ts'), 'export {};');
    expect((await ctx.service.run(crypto.randomUUID(), 'review this file', 'review.ts', [], null, null)).ok).toBe(true);
    expect(ctx.events.some(({ channel }) => channel === 'zappr:plan')).toBe(false);
  });
});
