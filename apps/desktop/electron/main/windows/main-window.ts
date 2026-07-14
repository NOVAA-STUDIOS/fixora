import { join } from 'node:path';

import { dark } from '@fixora/tokens';
import { BrowserWindow } from 'electron';

import { applyNavigationGuards, attachCspHeader } from '../security/navigation-guard.js';

/**
 * Every flag below is mandatory and CI-enforced (Security §2, TDD §3.2). They are written
 * explicitly rather than left to Electron's defaults, because a default is a decision someone
 * else gets to change in a minor release, and this is a decision we want to own.
 */
export function createMainWindow(devServerUrl: string | undefined): BrowserWindow {
  const isDev = devServerUrl !== undefined;

  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 940,
    minHeight: 600,
    // The window is created hidden and shown on `ready-to-show`, so the user never sees a
    // white flash before the theme has been applied. Cold start is a 2.0s budget (PRD §7);
    // a flash inside it still reads as "cheap".
    show: false,
    // The paint-before-first-frame colour. It must equal the dark canvas token, or the window
    // flashes a different shade before React mounts — so it *is* the token, not a copy of it.
    // The window is shown on `ready-to-show`, but a mismatch is still visible on some drivers.
    backgroundColor: dark.bg.canvas,
    autoHideMenuBar: true,
    webPreferences: {
      // CommonJS, not .mjs: Electron does not support an ESM preload in a sandboxed renderer,
      // and `sandbox: true` is not negotiable (Security §2).
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      webviewTag: false,
      spellcheck: false,
      // Middle-clicking a link fires `auxclick`, which can open a window down a path that
      // does not go through `setWindowOpenHandler`. Disabling the feature closes that door
      // rather than trusting that every future navigation path remembers to check.
      // (Found by Electronegativity's AUXCLICK_JS_CHECK, which is why the scanner is a gate.)
      disableBlinkFeatures: 'Auxclick',
    },
  });

  const appOrigin = isDev ? new URL(devServerUrl).origin : 'file://';

  attachCspHeader(window.webContents.session, {
    environment: isDev ? 'development' : 'production',
    appOrigin,
  });
  applyNavigationGuards(window, {
    environment: isDev ? 'development' : 'production',
    appOrigin,
  });

  window.once('ready-to-show', () => {
    window.show();
  });

  if (devServerUrl !== undefined) {
    void window.loadURL(devServerUrl);
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'));
  }

  return window;
}
