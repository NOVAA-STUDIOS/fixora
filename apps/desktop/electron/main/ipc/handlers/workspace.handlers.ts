import {
  UserFacingError,
  type DirEntryInfo,
  type FileContentInfo,
  type WorkspaceInfo,
} from '@fixora/shared-types';
import { BrowserWindow, dialog } from 'electron';

import { listDirectory, readTextFile, writeTextFile } from '../../services/fs/fs-service.js';
import { createWorkspaceWatcher, type WorkspaceWatcher } from '../../services/fs/watcher.js';
import type { WorkspaceService } from '../../services/workspace-service.js';
import { emitToWindow } from '../emit.js';
import { registerHandler } from '../router.js';

/**
 * One watcher at a time, restarted when the open workspace changes. The renderer re-lists only the
 * directories the batch names, so a burst of saves does not re-read the whole tree.
 */
let watcher: WorkspaceWatcher | null = null;
let watchedRoot: string | null = null;

function ensureWatching(service: WorkspaceService, window: BrowserWindow | null): void {
  const open = service.getCurrent();
  if (open === null || window === null) return;
  if (watchedRoot === open.rootPath && watcher !== null) return;

  void watcher?.close();
  watchedRoot = open.rootPath;
  watcher = createWorkspaceWatcher(open.rootPath, open.ignore, (changedDirs) => {
    if (!window.isDestroyed()) emitToWindow(window, 'workspace:filesChanged', { changedDirs });
  });
}

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
    const path = result.canceled || result.filePaths[0] === undefined ? null : result.filePaths[0];
    // The user just chose this folder in the native dialog, so authorize it: the path round-trips
    // through the renderer (which then calls workspace:open), and main only opens paths the user
    // actually picked or already-known recents — never an arbitrary string a hostile renderer sends.
    if (path !== null) service.authorize(path);
    return { path };
  });

  registerHandler('workspace:open', ({ path }, { window }) => {
    if (!service.isUserAuthorized(path)) {
      // A path the user never picked and that is not a known recent — refuse rather than turn a
      // renderer-fabricated path into the trusted FS root (invariant I1: the renderer is hostile).
      // Authored so the refusal explains itself. The security decision is unchanged — the path is
      // still refused; only the reporting improves.
      throw new UserFacingError(
        'Fixora only opens folders you pick yourself or have opened before. Use Open folder to choose it.',
        {
          code: 'unauthorized_path',
          action: { type: 'none', label: 'Dismiss' },
          stage: 'workspace',
        },
      );
    }
    const { workspace } = service.open(path);
    const open = service.requireRoot();
    ensureWatching(service, window);
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

  registerHandler('workspace:removeRecent', ({ id }) => {
    service.removeRecent(id);
    return { workspaces: service.recent().map(toInfo) };
  });

  registerHandler('workspace:clearRecent', () => {
    service.clearRecent();
    return { workspaces: service.recent().map(toInfo) };
  });

  registerHandler('workspace:setPinned', ({ id, pinned }) => {
    service.setPinned(id, pinned);
    return { workspaces: service.recent().map(toInfo) };
  });

  registerHandler('workspace:current', (_req, { window }) => {
    const current = service.getCurrent();
    // The restore-on-launch path opens the workspace before any window exists; start the watcher
    // now that the renderer (and its window) is here asking for the current workspace.
    ensureWatching(service, window);
    return {
      workspace:
        current === null
          ? null
          : {
              id: current.id,
              rootPath: current.rootPath,
              name: current.name,
              lastOpenedAt: 0,
              pinnedAt: null,
            },
    };
  });

  registerHandler('workspace:close', () => {
    // Stop watching first: a watcher outliving its workspace would keep emitting change events for a
    // folder the app no longer has open.
    void watcher?.close();
    watcher = null;
    watchedRoot = null;
    service.close();
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

  // Saving an edit the user made in the editor. Goes through the same guards as reading — the path is
  // workspace-relative, run through `assertInsideWorkspace`, and refused for a secrets-denylisted file
  // — so "the renderer can write" never means "the renderer can write anywhere".
  registerHandler('fs:writeFile', ({ relPath, content }) => {
    const { rootPath } = service.requireRoot();
    writeTextFile(rootPath, relPath, content);
  });
}

function toInfo(w: {
  id: string;
  rootPath: string;
  name: string;
  lastOpenedAt: number;
  pinnedAt: number | null;
}): WorkspaceInfo {
  return {
    id: w.id,
    rootPath: w.rootPath,
    name: w.name,
    lastOpenedAt: w.lastOpenedAt,
    pinnedAt: w.pinnedAt,
  };
}
