import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  BrowserWindow: { fromWebContents: vi.fn(() => null), getFocusedWindow: vi.fn(() => null) },
  dialog: { showOpenDialog: vi.fn() },
}));

let dbDir: string;
let repoDir: string;
let openDrivers: { close: () => void }[] = [];

beforeEach(() => {
  dbDir = mkdtempSync(join(tmpdir(), 'fixora-ws-handlers-db-'));
  repoDir = mkdtempSync(join(tmpdir(), 'fixora-ws-handlers-repo-'));
  mkdirSync(join(repoDir, 'src'));
  openDrivers = [];
});
afterEach(() => {
  for (const driver of openDrivers) driver.close();
  rmSync(dbDir, { recursive: true, force: true });
  rmSync(repoDir, { recursive: true, force: true });
});

async function freshHandlers() {
  vi.resetModules();
  const { getHandler } = await import('../electron/main/ipc/router.js');
  const { registerWorkspaceHandlers } =
    await import('../electron/main/ipc/handlers/workspace.handlers.js');
  const { openDatabase } = await import('../electron/main/db/database.js');
  const { createFileIndexRepository, createWorkspaceRepository } =
    await import('../electron/main/db/repositories.js');
  const { createWorkspaceService } = await import('../electron/main/services/workspace-service.js');

  const { driver } = openDatabase({ dir: dbDir });
  openDrivers.push(driver);
  const service = createWorkspaceService({
    workspaces: createWorkspaceRepository(driver),
    files: createFileIndexRepository(driver),
  });
  registerWorkspaceHandlers(service);
  return { getHandler, service };
}

const ctx = { requestId: 'r1', window: null };

/**
 * `workspace:setPinned` (Sprint F2, Welcome Experience). Everything else about the workspace
 * handlers is exercised via `workspace-service.test.ts` at the service layer; this file covers the
 * one new IPC channel end to end, including the `pinnedAt` field now carried on every `WorkspaceInfo`.
 */
describe('workspace:setPinned', () => {
  it('pins a project and returns it first in the updated recent list', async () => {
    const { getHandler, service } = await freshHandlers();
    const { workspace } = service.open(repoDir);

    const setPinned = getHandler('workspace:setPinned')!;
    const result = await setPinned({ id: workspace.id, pinned: true }, ctx);

    expect(result.workspaces[0]?.id).toBe(workspace.id);
    expect(result.workspaces[0]?.pinnedAt).not.toBeNull();
  });

  it('unpins a project back to null', async () => {
    const { getHandler, service } = await freshHandlers();
    const { workspace } = service.open(repoDir);

    const setPinned = getHandler('workspace:setPinned')!;
    await setPinned({ id: workspace.id, pinned: true }, ctx);
    const result = await setPinned({ id: workspace.id, pinned: false }, ctx);

    expect(result.workspaces[0]?.pinnedAt).toBeNull();
  });

  it('every WorkspaceInfo from workspace:recent carries a pinnedAt field', async () => {
    const { getHandler, service } = await freshHandlers();
    service.open(repoDir);

    const recent = getHandler('workspace:recent')!;
    const result = await recent({}, ctx);
    expect(result.workspaces[0]).toHaveProperty('pinnedAt');
  });
});
