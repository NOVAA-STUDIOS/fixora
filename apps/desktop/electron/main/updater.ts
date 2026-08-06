import { app, BrowserWindow } from 'electron';
import { autoUpdater } from 'electron-updater';

import { emitToWindow } from './ipc/emit.js';
import { registerHandler } from './ipc/router.js';

/**
 * Auto-update (electron-updater over the GitHub provider already configured in
 * electron-builder.yml). Silent and additive: a user who never notices an update still gets one on
 * the next launch, and one who does notice sees exactly two moments — available, then ready — never
 * a progress bar or a choice to make until the very last step.
 *
 * `checkForUpdatesAndNotify` both checks and downloads; there is no separate "download" step to
 * wire. What IS wired here is telling the renderer, because the library's own native OS
 * notification is easy to miss under a window that has focus, and gives no way to trigger install
 * from inside the app.
 */
export function initAutoUpdater(): void {
  // Every build in dev and CI is unsigned and unpublished; checking there only produces a support
  // request out of a state nobody can act on. Packaged is the only environment with something to
  // check FOR.
  if (!app.isPackaged) return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false;

  // The only window this app ever has (see the single-instance lock in index.ts). Looked up at
  // emit time rather than captured at init, because init runs before the window exists.
  const currentWindow = (): BrowserWindow | null => BrowserWindow.getAllWindows()[0] ?? null;

  autoUpdater.on('update-available', (info) => {
    const window = currentWindow();
    if (window !== null) emitToWindow(window, 'update:available', { version: info.version });
  });

  autoUpdater.on('update-downloaded', (info) => {
    const window = currentWindow();
    if (window !== null) emitToWindow(window, 'update:downloaded', { version: info.version });
  });

  // Never fatal. A user whose update check failed — offline, GitHub down, no release published
  // yet — is still running a working copy of the app; this must never surface as an app error.
  autoUpdater.on('error', (error) => {
    console.error('[updater] check/download failed', { detail: error.message });
  });

  autoUpdater.checkForUpdatesAndNotify().catch((error: unknown) => {
    console.error('[updater] checkForUpdatesAndNotify rejected', {
      detail: error instanceof Error ? error.message : String(error),
    });
  });
}

/**
 * The user's one decision: apply what has already downloaded. Registered unconditionally — in dev
 * the channel must still exist (`assertEveryChannelIsHandled` requires it) even though it can never
 * fire, since `update:downloaded` is never emitted there.
 */
export function registerUpdateHandlers(): void {
  registerHandler('update:install', () => {
    autoUpdater.quitAndInstall();
  });
}
