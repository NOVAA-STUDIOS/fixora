import { app, BrowserWindow } from 'electron';
import log from 'electron-log';
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

/**
 * Set once `update-downloaded` actually fires, and the only thing `update:install` consults.
 * `quitAndInstall()` on a nothing-downloaded state is a bug the renderer must not be able to
 * trigger merely by calling the channel early or twice — this is the guard, not the renderer's
 * word for it.
 */
let downloaded = false;

export function initAutoUpdater(): void {
  // TEMPORARY debug logging — remove once it's confirmed this runs in a packaged build.
  console.log('AUTO-UPDATER STARTED', { isPackaged: app.isPackaged, version: app.getVersion() });

  // Every build in dev and CI is unsigned and unpublished; checking there only produces a support
  // request out of a state nobody can act on. Packaged is the only environment with something to
  // check FOR.
  if (!app.isPackaged) return;

  // File logging, so a failed check on a user's machine is something they can send us rather than
  // something that only ever existed in a console window they never had open. electron-log's
  // default transport already resolves to the platform log directory on its own.
  autoUpdater.logger = log;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false;
  // Beta releases are published as prerelease semver (`1.0.0-beta.N`) — without this the updater
  // only ever looks at full releases, and a beta build would never see another beta.
  autoUpdater.allowPrerelease = true;

  // The only window this app ever has (see the single-instance lock in index.ts). Looked up at
  // emit time rather than captured at init, because init runs before the window exists.
  const currentWindow = (): BrowserWindow | null => BrowserWindow.getAllWindows()[0] ?? null;

  autoUpdater.on('update-available', (info) => {
    const window = currentWindow();
    if (window === null) return;
    // `releaseNotes` can be a string, a per-version array, or absent depending on the provider —
    // only the string case is ever meaningful to show, so anything else is treated as "none".
    const releaseNotes = typeof info.releaseNotes === 'string' ? info.releaseNotes : undefined;
    emitToWindow(window, 'update:available', {
      version: info.version,
      ...(releaseNotes !== undefined ? { releaseNotes } : {}),
    });
  });

  autoUpdater.on('download-progress', (progress) => {
    const window = currentWindow();
    if (window !== null) emitToWindow(window, 'update:progress', { percent: progress.percent });
  });

  autoUpdater.on('update-downloaded', (info) => {
    downloaded = true;
    const window = currentWindow();
    if (window !== null) emitToWindow(window, 'update:downloaded', { version: info.version });
  });

  // Never fatal. A user whose update check failed — offline, GitHub down, no release published
  // yet — is still running a working copy of the app; this must never surface as an app error.
  // It still reaches the renderer, though: `update:error` is informational, not a failure state
  // anything gates on, so telling the user "couldn't check for updates" costs nothing and beats
  // a check that silently never completes.
  autoUpdater.on('error', (error) => {
    console.error('[updater] check/download failed', { detail: error.message });
    const window = currentWindow();
    if (window !== null) emitToWindow(window, 'update:error', { message: error.message });
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
    // Nothing to install is not an error — it is simply not yet true, and `quitAndInstall()` on
    // that state is exactly the bug this flag exists to rule out.
    if (!downloaded) {
      console.error('[updater] update:install called with nothing downloaded — ignored');
      return;
    }
    autoUpdater.quitAndInstall(true, true);
  });
}
