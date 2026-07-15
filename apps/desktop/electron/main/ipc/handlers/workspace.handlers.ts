import type { DirEntryInfo, FileContentInfo, WorkspaceInfo } from '@fixora/shared-types';
import { BrowserWindow, dialog } from 'electron';

import { listDirectory, readTextFile } from '../../services/fs/fs-service.js';
import type { WorkspaceService } from '../../services/workspace-service.js';
import { registerHandler } from '../router.js';

/**
 * Workspace + filesystem handlers. The renderer drives the file tree and the editor through these,
 * always with **workspace-relative** paths — main pairs each with the root the workspace service
 * owns and runs it through the path guard (Security §3). The renderer cannot name a path outside
 * the workspace, and the root never crosses the boundary.
 *
 * Indexing the whole tree (for M3) runs after `open` returns, so the first paint is not blocked on
 * walking a 10k-file repo — the tree renders from lazy `fs:listDir` calls.
 */
export function registerWorkspaceHandlers(service: WorkspaceService): void {
  registerHandler('workspace:pickFolder', async (_req, { window }) => {
    const owner = window ?? BrowserWindow.getFocusedWindow() ?? undefined;
    const result = await dialog.showOpenDialog(owner as BrowserWindow, {
      title: 'Open folder',
      properties: ['openDirectory'],
    });
    return { path: result.canceled || result.filePaths[0] === undefined ? null : result.filePaths[0] };
  });

  registerHandler('workspace:open', ({ path }) => {
    const { workspace } = service.open(path);
    const open = service.requireRoot();
    // Kick off indexing in the background; do not await it (first paint must not wait).
    setImmediate(() => {
      try {
        service.indexFiles(open);
      } catch {
        // Indexing feeds M3; a failure here must not break opening the workspace.
      }
    });
    return { workspace: toInfo(workspace) };
  });

  registerHandler('workspace:recent', () => ({
    workspaces: service.recent().map(toInfo),
  }));

  registerHandler('workspace:current', () => {
    const current = service.getCurrent();
    return {
      workspace:
        current === null
          ? null
          : {
              id: current.id,
              rootPath: current.rootPath,
              name: current.name,
              lastOpenedAt: 0,
            },
    };
  });

  registerHandler('fs:listDir', ({ relPath }) => {
    const { rootPath, ignore } = service.requireRoot();
    const entries: DirEntryInfo[] = listDirectory(rootPath, relPath, ignore);
    return { entries };
  });

  registerHandler('fs:readFile', ({ relPath }) => {
    const { rootPath } = service.requireRoot();
    const file: FileContentInfo = readTextFile(rootPath, relPath);
    return { file };
  });
}

function toInfo(w: { id: string; rootPath: string; name: string; lastOpenedAt: number }): WorkspaceInfo {
  return { id: w.id, rootPath: w.rootPath, name: w.name, lastOpenedAt: w.lastOpenedAt };
}
