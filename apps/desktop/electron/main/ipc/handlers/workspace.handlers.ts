import { join } from 'node:path';

import {
  UserFacingError,
  type DirEntryInfo,
  type FileContentInfo,
  type WorkspaceInfo,
} from '@fixora/shared-types';
import { BrowserWindow, dialog } from 'electron';

import {
  createDirectory,
  createFile,
  deletePath,
  listDirectory,
  readTextFile,
  renamePath,
  writeTextFile,
  writeWorkspaceFile,
} from '../../services/fs/fs-service.js';
import { createWorkspaceWatcher, type WorkspaceWatcher } from '../../services/fs/watcher.js';
import type { WorkspaceService } from '../../services/workspace-service.js';
import { emitToWindow } from '../emit.js';
import { registerHandler } from '../router.js';

import { stopAnalysisWatch } from './analysis.handlers.js';

/**
 * One watcher at a time, restarted when the open workspace changes. The renderer re-lists only the
 * directories the batch names, so a burst of saves does not re-read the whole tree.
 */
let watcher: WorkspaceWatcher | null = null;
let watchedRoot: string | null = null;

/**
 * Startup hang fix: chokidar's initial watch does a synchronous readdir walk of the tree, which
 * competes with the renderer's own boot for the event loop right when the splash is narrating
 * "Loading workspace…". Deferred 2s past the guard checks below (which stay synchronous, so a
 * rapid re-open still short-circuits correctly) — long enough to be clear of first paint, short
 * enough that live file-change events are still effectively immediate to the user.
 */
const WATCH_START_DELAY_MS = 2000;

function ensureWatching(service: WorkspaceService, window: BrowserWindow | null): void {
  const open = service.getCurrent();
  if (open === null || window === null) return;
  if (watchedRoot === open.rootPath && watcher !== null) return;

  void watcher?.close();
  watchedRoot = open.rootPath;
  watcher = null;
  setTimeout(() => {
    if (service.getCurrent()?.rootPath !== open.rootPath || window.isDestroyed()) return;
    watcher = createWorkspaceWatcher(open.rootPath, open.ignore, (changedDirs) => {
      if (!window.isDestroyed()) emitToWindow(window, 'workspace:filesChanged', { changedDirs });
    });
  }, WATCH_START_DELAY_MS);
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
    // Kick off indexing in the background; do not await it (first paint must not wait). Delayed
    // the same 2s as the watcher above — indexing a large repo is exactly the other synchronous
    // walk that was competing with the renderer's own startup work.
    setTimeout(() => {
      service
        .indexFiles(open, undefined, (indexed) => {
          if (window !== null && !window.isDestroyed()) {
            emitToWindow(window, 'workspace:indexProgress', { indexed });
          }
        })
        .then((fileCount) => {
          // Informational only — the always-ignore set (ignore-rules.ts) already excludes
          // node_modules/dist/build/out/etc from both the tree and analysis by default, so there
          // is no toggle to offer here; this just tells the user their project is the size it is.
          if (fileCount >= 50_000 && window !== null && !window.isDestroyed()) {
            emitToWindow(window, 'workspace:largeProject', { fileCount });
          }
        })
        .catch(() => {
          // Indexing feeds M3; a failure here must not break opening the workspace.
        });
    }, WATCH_START_DELAY_MS);
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
    // Watch Mode (analysis.handlers.ts) is a separate watcher, scoped to the same workspace — must
    // stop for the same reason: re-analyzing files in a folder that is no longer open.
    stopAnalysisWatch();
    service.close();
  });

  registerHandler('fs:listDir', async ({ relPath }) => {
    const { rootPath, ignore } = service.requireRoot();
    const entries: DirEntryInfo[] = await listDirectory(rootPath, relPath, ignore);
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

  // Generated files (GitHub Actions panel): creates missing parent directories and overwrites an
  // existing file at that path — "Generate workflow file" clicked twice must replace, not refuse.
  registerHandler('fs:writeWorkspaceFile', ({ relPath, content }) => {
    const { rootPath } = service.requireRoot();
    writeWorkspaceFile(rootPath, relPath, content);
    return { absolutePath: join(rootPath, relPath) };
  });

  // File tree context menu / "+" button. Same guards as read/write: workspace-relative,
  // path-guarded, refused for a secrets-denylisted path.
  registerHandler('fs:createFile', ({ relPath }) => {
    const { rootPath } = service.requireRoot();
    createFile(rootPath, relPath);
  });
  registerHandler('fs:createDir', ({ relPath }) => {
    const { rootPath } = service.requireRoot();
    createDirectory(rootPath, relPath);
  });
  registerHandler('fs:rename', ({ fromRelPath, toRelPath }) => {
    const { rootPath } = service.requireRoot();
    renamePath(rootPath, fromRelPath, toRelPath);
  });
  registerHandler('fs:delete', ({ relPath }) => {
    const { rootPath } = service.requireRoot();
    deletePath(rootPath, relPath);
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
