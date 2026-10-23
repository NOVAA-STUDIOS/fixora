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
  };
});

const roots: string[] = [];

afterEach(() => {
  controls.failWritePath = null;
  controls.afterWrite = null;
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function setup(plan: object) {
  const rootPath = mkdtempSync(join(tmpdir(), 'fixora-zappr-cross-repair-'));
  roots.push(rootPath);
  const srcPath = join(rootPath, 'src');
  mkdirSync(srcPath);
  const open = { id: 'workspace-cross-repair', rootPath, name: 'cross-repair', ignore: loadIgnoreRules(rootPath) };
  const events: { channel: string; payload: unknown }[] = [];
  const prompts: string[] = [];
  const window = {
    isDestroyed: () => false,
    webContents: { send: (channel: string, payload: unknown) => events.push({ channel, payload }) },
  } as unknown as BrowserWindow;
  const raw = JSON.stringify(plan);
  const candidate = {
    provider: 'test',
    model: 'test',
    adapter: {
      stream: async function* (request: { messages: { content: string }[] }) {
        prompts.push(request.messages[0]?.content ?? '');
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
  const runRepair = (prompt = 'Fix this error across related files and add a focused test') => {
    const runId = crypto.randomUUID();
    return { runId, result: service.run(runId, prompt, 'src/main.ts', [], null, null, ['src/types.ts'], ['src/consumer.ts']) };
  };
  return { rootPath, events, prompts, service, runRepair };
}

function approvalId(ctx: ReturnType<typeof setup>): string {
  const event = ctx.events.find(({ channel }) => channel === 'zappr:plan');
  expect(event).toBeDefined();
  return (event?.payload as { approvalId: string }).approvalId;
}

describe('Zappr constrained cross-file repair', () => {
  it('proposes a coordinated edit/edit/create plan and waits for approval before writing', async () => {
    const ctx = setup({ summary: 'Update symbol consumers and add a test.', steps: [
      { type: 'edit', filePath: 'src/main.ts', description: 'Repair implementation', content: 'export const renamed = true;' },
      { type: 'edit', filePath: 'src/types.ts', description: 'Update dependent type', content: 'export type Result = boolean;' },
      { type: 'edit', filePath: 'src/consumer.ts', description: 'Update renamed import and consumer', content: 'import { renamed } from "./main";\nvoid renamed;' },
      { type: 'create', filePath: 'src/main.test.ts', description: 'Add focused regression test', content: 'import { renamed } from "./main";\nexpect(renamed).toBe(true);' },
    ] });
    writeFileSync(join(ctx.rootPath, 'src', 'main.ts'), 'export const oldName = true;');
    writeFileSync(join(ctx.rootPath, 'src', 'types.ts'), 'export type Result = string;');
    writeFileSync(join(ctx.rootPath, 'src', 'consumer.ts'), 'import { oldName } from "./main";');

    const { runId, result } = ctx.runRepair('Fix this error across related files, update the type consumer, and add a focused test');
    await expect(result).resolves.toEqual({ ok: true });
    expect(ctx.prompts[0]).toContain('constrained, coordinated cross-file repair');
    expect(ctx.prompts[0]).toContain('Use edit for every existing file');
    expect(ctx.prompts[0]).toContain('src/consumer.ts');
    expect(existsSync(join(ctx.rootPath, 'src', 'main.test.ts'))).toBe(false);
    const planEvent = ctx.events.find(({ channel }) => channel === 'zappr:plan');
    expect((planEvent?.payload as { steps: { type: string }[] }).steps.map(({ type }) => type)).toEqual(['edit', 'edit', 'edit', 'create']);

    await expect(ctx.service.approvePlan(approvalId(ctx), runId)).resolves.toEqual({ ok: true });
    expect(readFileSync(join(ctx.rootPath, 'src', 'main.ts'), 'utf8')).toBe('export const renamed = true;');
    expect(readFileSync(join(ctx.rootPath, 'src', 'types.ts'), 'utf8')).toBe('export type Result = boolean;');
    expect(readFileSync(join(ctx.rootPath, 'src', 'consumer.ts'), 'utf8')).toContain('renamed');
    expect(existsSync(join(ctx.rootPath, 'src', 'main.test.ts'))).toBe(true);
    expect(ctx.events.some(({ channel, payload }) => channel === 'zappr:done' && (payload as { chatResponse?: string }).chatResponse === '4 files repaired successfully')).toBe(true);
  });

  it('keeps ordinary one-file repair on the existing prompt and approval path', async () => {
    const ctx = setup({ summary: 'Fix one file.', steps: [
      { type: 'edit', filePath: 'src/main.ts', description: 'Fix issue', content: 'export const fixed = true;' },
    ] });
    writeFileSync(join(ctx.rootPath, 'src', 'main.ts'), 'export const broken = true;');
    const { result } = ctx.runRepair('Fix this error in the current file');
    await expect(result).resolves.toEqual({ ok: true });
    expect(ctx.prompts[0]).toContain('FILE TO FIX: src/main.ts');
    expect(ctx.prompts[0]).not.toContain('coordinated cross-file repair');
    expect(readFileSync(join(ctx.rootPath, 'src', 'main.ts'), 'utf8')).toBe('export const broken = true;');
  });

  it('rejects plans over five steps, duplicate targets, and create-on-existing before approval', async () => {
    const overLimit = setup({ summary: 'too many', steps: Array.from({ length: 6 }, (_, index) => ({
      type: 'create', filePath: `src/new-${String(index)}.ts`, description: 'new', content: 'export {};',
    })) });
    const tooMany = overLimit.runRepair();
    await expect(tooMany.result).resolves.toMatchObject({ ok: false });
    expect(overLimit.events.some(({ channel }) => channel === 'zappr:plan')).toBe(false);

    const duplicate = setup({ summary: 'duplicate', steps: [
      { type: 'edit', filePath: 'src/main.ts', description: 'first', content: 'one' },
      { type: 'edit', filePath: 'src/./main.ts', description: 'same target', content: 'two' },
    ] });
    writeFileSync(join(duplicate.rootPath, 'src', 'main.ts'), 'original');
    await expect(duplicate.runRepair().result).resolves.toMatchObject({ ok: false });
    expect(readFileSync(join(duplicate.rootPath, 'src', 'main.ts'), 'utf8')).toBe('original');

    const wrongAction = setup({ summary: 'wrong action', steps: [
      { type: 'create', filePath: 'src/main.ts', description: 'replace existing file', content: 'new' },
    ] });
    writeFileSync(join(wrongAction.rootPath, 'src', 'main.ts'), 'original');
    await expect(wrongAction.runRepair().result).resolves.toMatchObject({ ok: false });
    expect(wrongAction.events.some(({ channel }) => channel === 'zappr:plan')).toBe(false);
    expect(readFileSync(join(wrongAction.rootPath, 'src', 'main.ts'), 'utf8')).toBe('original');
  });

  it('rechecks create/edit existence during approval preflight before any write', async () => {
    const ctx = setup({ summary: 'Add the missing test.', steps: [
      { type: 'create', filePath: 'src/new.test.ts', description: 'Add focused test', content: 'new test' },
    ] });
    writeFileSync(join(ctx.rootPath, 'src', 'main.ts'), 'original main');
    const { runId, result } = ctx.runRepair('Fix this bug across related files');
    await expect(result).resolves.toEqual({ ok: true });
    writeFileSync(join(ctx.rootPath, 'src', 'new.test.ts'), 'created while awaiting approval');
    const execution = await ctx.service.approvePlan(approvalId(ctx), runId);
    expect(execution.ok).toBe(false);
    expect(readFileSync(join(ctx.rootPath, 'src', 'new.test.ts'), 'utf8')).toBe('created while awaiting approval');
    expect(ctx.events.some(({ channel, payload }) => channel === 'zappr:done' && (payload as { success: boolean }).success)).toBe(false);
  });

  it('rolls back a previous file when a later approved repair write fails', async () => {
    const ctx = setup({ summary: 'Repair related files.', steps: [
      { type: 'edit', filePath: 'src/main.ts', description: 'Repair source', content: 'changed' },
      { type: 'edit', filePath: 'src/types.ts', description: 'Repair type', content: 'changed' },
    ] });
    writeFileSync(join(ctx.rootPath, 'src', 'main.ts'), 'original main');
    writeFileSync(join(ctx.rootPath, 'src', 'types.ts'), 'original types');
    controls.failWritePath = 'src/types.ts';
    const { runId, result } = ctx.runRepair('Repair this issue across related files');
    await expect(result).resolves.toEqual({ ok: true });
    const execution = await ctx.service.approvePlan(approvalId(ctx), runId);
    expect(execution.ok).toBe(false);
    expect(readFileSync(join(ctx.rootPath, 'src', 'main.ts'), 'utf8')).toBe('original main');
    expect(readFileSync(join(ctx.rootPath, 'src', 'types.ts'), 'utf8')).toBe('original types');
    expect(ctx.events.some(({ channel, payload }) => channel === 'zappr:done' && (payload as { success: boolean }).success)).toBe(false);
  });

  it('cancels at a safe boundary and rolls back prior edits; a newer run invalidates the stale approval', async () => {
    const ctx = setup({ summary: 'Repair related files.', steps: [
      { type: 'edit', filePath: 'src/main.ts', description: 'Repair source', content: 'changed' },
      { type: 'edit', filePath: 'src/types.ts', description: 'Repair type', content: 'changed' },
    ] });
    writeFileSync(join(ctx.rootPath, 'src', 'main.ts'), 'original main');
    writeFileSync(join(ctx.rootPath, 'src', 'types.ts'), 'original types');
    const { runId, result } = ctx.runRepair('Repair this issue across related files');
    await result;
    const staleApprovalId = approvalId(ctx);
    controls.afterWrite = (path) => { if (path === 'src/main.ts') ctx.service.cancel(runId); };
    await expect(ctx.service.approvePlan(staleApprovalId, runId)).resolves.toMatchObject({ ok: false });
    expect(readFileSync(join(ctx.rootPath, 'src', 'main.ts'), 'utf8')).toBe('original main');
    expect(readFileSync(join(ctx.rootPath, 'src', 'types.ts'), 'utf8')).toBe('original types');

    const next = ctx.runRepair();
    await next.result;
    expect((await ctx.service.approvePlan(staleApprovalId, runId)).ok).toBe(false);
  });
});
