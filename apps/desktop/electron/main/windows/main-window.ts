import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { dark } from '@fixora/tokens';
import { BrowserWindow, app } from 'electron';
import elog from 'electron-log';

import { emitToWindow } from '../ipc/emit.js';
import {
  applyNavigationGuards,
  attachCspHeader,
  type GuardOptions,
} from '../security/navigation-guard.js';

/**
 * Every flag below is mandatory and CI-enforced (Security §2, TDD §3.2). They are written
 * explicitly rather than left to Electron's defaults, because a default is a decision someone
 * else gets to change in a minor release, and this is a decision we want to own.
 */
/**
 * The window icon.
 *
 * On Windows a packaged app inherits the icon compiled into the .exe, so this is what the DEV app
 * shows — which, unset, was Electron's default atom in the taskbar and Alt-Tab while the app itself
 * rendered the Fixora mark. On Linux there is no exe resource to inherit from and this is the only
 * icon the window manager gets.
 *
 * Two locations, because the file lives in two different places. Packaged, it is beside the asar via
 * `extraResources` — it cannot ship inside it, since electron-builder excludes `buildResources`
 * (build/) from the app package. In development there is no resources dir, so it comes from build/
 * directly, `__dirname` being out/main.
 *
 * Guarded by an existence check: a missing icon should fall back to the platform default rather than
 * fail a launch over decoration.
 */
const ICON_PATH = app.isPackaged
  ? join(process.resourcesPath, 'icon.png')
  : join(__dirname, '../../build/icon.png');

// `setAppDetails`'s `appIconPath` wants a real .ico (multi-size PE icon resource) rather than the
// .png above — same packaged/dev resolution as ICON_PATH, just the other extension and its own
// `extraResources` entry (electron-builder.yml).
const ICO_PATH = app.isPackaged
  ? join(process.resourcesPath, 'icon.ico')
  : join(__dirname, '../../build/icon.ico');

export function createMainWindow(
  devServerUrl: string | undefined,
  onFirstPaint?: () => void,
): BrowserWindow {
  const window = new BrowserWindow({
    ...(existsSync(ICON_PATH) ? { icon: ICON_PATH } : {}),
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
    // Frameless: we draw our own title bar (Design Review §5, M1). The OS chrome is removed and
    // the renderer supplies the drag region and the minimise/maximise/close controls, wired to
    // main over the `window:*` IPC channels — the renderer cannot act on the window itself.
    frame: false,
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

  // The directory the renderer is loaded from — navigation is confined to it in production.
  const rendererRoot = join(__dirname, '../renderer');
  const guardOptions: GuardOptions =
    devServerUrl !== undefined
      ? { environment: 'development', appOrigin: new URL(devServerUrl).origin }
      : { environment: 'production', rendererRoot };

  attachCspHeader(window.webContents.session, guardOptions);
  applyNavigationGuards(window, guardOptions);

  if (process.env['FIXORA_DEBUG'] === '1') {
    attachDebugInstrumentation(window);
  }

  window.once('ready-to-show', () => {
    window.show();
    onFirstPaint?.();
  });

  // The actual "(Not Responding)" state: the renderer's process is alive but has stopped pumping
  // its message loop for several seconds (Chromium's own hang detector), typically because
  // synchronous JS — a heavy computation, a blocking main-process IPC call it's awaiting — is
  // holding the thread. Distinct from `render-process-gone` (index.ts), which only fires once the
  // process has actually died; this is the earlier, more common case a user reports as freezing.
  window.on('unresponsive', () => {
    elog.error('[main] window unresponsive', { title: window.getTitle() });
  });
  window.on('responsive', () => {
    elog.warn('[main] window responsive again', { title: window.getTitle() });
  });

  // The window can be maximised/restored by ways the renderer never sees — the OS snap shortcut
  // (Win+Up), a double-click on the drag region, or a display change. So main is the source of
  // truth for the maximised state and pushes it; the title-bar button reflects, never guesses.
  const pushMaximizedState = (): void => {
    emitToWindow(window, 'window:maximizedChanged', { isMaximized: window.isMaximized() });
  };
  window.on('maximize', pushMaximizedState);
  window.on('unmaximize', pushMaximizedState);

  if (process.platform === 'win32') {
    window.setAppDetails({
      appId: 'dev.fixora.app',
      appIconPath: ICO_PATH,
      relaunchDisplayName: 'Fixora',
    });
  }

  if (devServerUrl !== undefined) {
    void window.loadURL(devServerUrl);
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'));
  }

  return window;
}

/**
 * Black-screen diagnostics, gated behind `FIXORA_DEBUG=1` — off for every normal run, and retained
 * deliberately: a black window is the one failure a user cannot describe, so the flag is what turns
 * "it didn't start" into a report. Opens DevTools and logs every
 * signal that distinguishes the black-screen causes from each other: a load failure, a preload
 * throw, a renderer crash before first paint, or a mounted-but-not-painted DOM (a compositor issue).
 */
function attachDebugInstrumentation(window: BrowserWindow): void {
  const wc = window.webContents;
  const log = (...a: unknown[]): void => {
    console.error('[debug]', ...a);
  };

  wc.on('did-fail-load', (_e, code, desc, url) => {
    log('did-fail-load', { code, desc, url });
  });
  wc.on('preload-error', (_e, path, error) => {
    log('preload-error', { path, error: String(error) });
  });
  wc.on('render-process-gone', (_e, details) => {
    log('render-process-gone', details);
  });
  wc.on('console-message', (_e, level, message, line, sourceId) => {
    log('console', { level, message, line, sourceId });
  });
  wc.on('unresponsive', () => {
    log('unresponsive');
  });

  wc.on('dom-ready', () => {
    log('dom-ready');
  });
  wc.on('did-finish-load', () => {
    log('did-finish-load — probing the DOM');
    void wc
      .executeJavaScript(
        `(() => {
          const root = document.getElementById('root');
          return {
            hasRoot: !!root,
            rootChildCount: root ? root.childElementCount : -1,
            rootHtmlLength: root ? root.innerHTML.length : -1,
            bodyBg: getComputedStyle(document.body).backgroundColor,
            scriptCount: document.scripts.length,
            title: document.title,
          };
        })()`,
      )
      .then(
        (r) => {
          log('DOM probe', r);
        },
        (err: unknown) => {
          log('DOM probe failed', String(err));
        },
      );
  });

  window.once('ready-to-show', () => {
    log('ready-to-show fired — opening DevTools');
    wc.openDevTools({ mode: 'detach' });
  });
}
