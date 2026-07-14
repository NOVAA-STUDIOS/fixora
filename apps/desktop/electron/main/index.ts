import { app, BrowserWindow } from 'electron';

import { registerSystemHandlers } from './ipc/handlers/system.handlers.js';
import { registerWindowHandlers } from './ipc/handlers/window.handlers.js';
import { assertEveryChannelIsHandled, mountRouter } from './ipc/router.js';
import { createMainWindow } from './windows/main-window.js';

/**
 * App lifecycle.
 *
 * The single-instance lock is not politeness (TDD §3.1). It is load-bearing twice over: the
 * `fixora://` auth callback must be forwarded to the already-running window (M4), and two
 * processes writing one SQLite file is corruption (M2). Both of those are milestones away,
 * and both are impossible to retrofit into a process model that permits a second instance —
 * so the lock is here from the first commit.
 */

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  const devServerUrl = process.env['ELECTRON_RENDERER_URL'];

  app.on('second-instance', () => {
    const [existing] = BrowserWindow.getAllWindows();
    if (existing !== undefined) {
      if (existing.isMinimized()) existing.restore();
      existing.focus();
    }
  });

  app.whenReady().then(
    () => {
      registerSystemHandlers();
      registerWindowHandlers();
      // Fail fast, at startup, if any declared channel has no handler — before a window
      // exists to send it a request (Standards §2).
      assertEveryChannelIsHandled();
      mountRouter();

      createMainWindow(devServerUrl);

      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
          createMainWindow(devServerUrl);
        }
      });
    },
    (error: unknown) => {
      console.error('[main] failed to start', error);
      app.quit();
    },
  );

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  /**
   * A renderer process that dies takes its window with it, not the app. From M2 that window
   * may hold unsaved work, so the recovery path is a milestone-2 concern — but the listener
   * exists now so the failure is visible in logs rather than silent.
   */
  app.on('render-process-gone', (_event, _webContents, details) => {
    console.error('[main] renderer process gone', { reason: details.reason });
  });

  app.on('child-process-gone', (_event, details) => {
    console.error('[main] child process gone', { type: details.type, reason: details.reason });
  });
}
