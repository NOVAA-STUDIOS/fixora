import { type BrowserWindow } from 'electron';

import { registerHandler } from '../router.js';

/**
 * Window-control handlers for the custom (frameless) title bar. The renderer draws the
 * minimise/maximise/close buttons but cannot act on the window itself — it asks main to, over
 * these channels. Each returns the resulting maximised state so the button icon updates without
 * a second round-trip.
 *
 * `context.window` is the window the call came from (router derives it from the sender), so a
 * future multi-window world controls the right one rather than a global "focused window".
 */
function windowState(window: BrowserWindow | null): { isMaximized: boolean } {
  return { isMaximized: window?.isMaximized() ?? false };
}

export function registerWindowHandlers(): void {
  registerHandler('window:minimize', (_req, { window }) => {
    window?.minimize();
    return windowState(window);
  });

  registerHandler('window:toggleMaximize', (_req, { window }) => {
    if (window === null) return windowState(null);
    if (window.isMaximized()) {
      window.unmaximize();
    } else {
      window.maximize();
    }
    return windowState(window);
  });

  registerHandler('window:close', (_req, { window }) => {
    window?.close();
  });

  registerHandler('window:isMaximized', (_req, { window }) => windowState(window));
}
