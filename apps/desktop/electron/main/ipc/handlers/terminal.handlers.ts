import { UserFacingError } from '@fixora/shared-types';
import { app, type BrowserWindow } from 'electron';

import type { WorkspaceService } from '../../services/workspace-service.js';
import { createTerminalService } from '../../terminal/terminal-service.js';
import { emitToWindow } from '../emit.js';
import { registerHandler } from '../router.js';

/**
 * Integrated terminal handlers. Every session is rooted at the open workspace's folder — there is
 * no channel to open one anywhere else, the same trust shape as `fs:*` (Security §3). The id is
 * minted by the renderer (one per tab) so create/write/resize/dispose all address a session by a
 * value main never has to allocate or hand back.
 *
 * Output/exit are pushed to whichever window created the session, looked up at emit time (like
 * the updater does) rather than captured once, since the callback outlives any single IPC call.
 */
export function registerTerminalHandlers(workspace: WorkspaceService): void {
  const windowsBySession = new Map<string, BrowserWindow>();

  const service = createTerminalService({
    onData(id, data) {
      const window = windowsBySession.get(id);
      if (window !== undefined && !window.isDestroyed()) {
        emitToWindow(window, 'terminal:data', { id, data });
      }
    },
    onExit(id, exitCode) {
      const window = windowsBySession.get(id);
      windowsBySession.delete(id);
      if (window !== undefined && !window.isDestroyed()) {
        emitToWindow(window, 'terminal:exit', { id, exitCode });
      }
    },
  });

  registerHandler('terminal:create', ({ id, cols, rows }, { window }) => {
    const open = workspace.getCurrent();
    if (open === null) {
      throw new UserFacingError('Open a folder before starting a terminal.', {
        code: 'no_workspace',
        action: { type: 'none', label: 'Dismiss' },
        stage: 'workspace',
      });
    }
    if (window !== null) windowsBySession.set(id, window);
    const shell = service.create(id, open.rootPath, cols, rows);
    return { shell };
  });

  registerHandler('terminal:write', ({ id, data }) => {
    service.write(id, data);
  });

  registerHandler('terminal:resize', ({ id, cols, rows }) => {
    service.resize(id, cols, rows);
  });

  registerHandler('terminal:dispose', ({ id }) => {
    windowsBySession.delete(id);
    service.dispose(id);
  });

  // The renderer cannot be trusted to always get to dispose (crash, force-quit) — a leaked shell
  // process outliving the app is the failure this guards against. Registered here rather than at
  // window-creation time: this runs before `createMainWindow` in index.ts's startup sequence, the
  // same reason `analysisHost`/`verification` clean up on `will-quit` rather than a window event.
  app.on('will-quit', () => {
    service.disposeAll();
  });
}
