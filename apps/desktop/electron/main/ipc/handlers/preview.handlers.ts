import type { BrowserWindow, Rectangle } from 'electron';

import type { PreviewService } from '../../services/preview-service.js';
import { registerHandler } from '../router.js';

/**
 * Fixora Preview's IPC surface — thin: every real decision (localhost-only navigation, view
 * lifecycle) lives in `preview-service.ts`. Handlers here only translate requests into calls on
 * the one service instance `index.ts`'s `startBackend` constructs.
 */

/** A generous default: the panel resizes it for real on its first `preview:resize` call
 *  (preview-panel.tsx's `ResizeObserver`) — this only avoids a zero-size flash before that. */
const DEFAULT_BOUNDS = { x: 0, y: 0, width: 800, height: 600 };

/** Activity rail width — the preview view starts just past it, never under it. */
const RAIL_WIDTH = 64;
/** Small gap between the activity rail and the preview view. */
const GAP = 8;
/** h-10 */
const TITLE_BAR_HEIGHT = 40;
/** Preview panel's own toolbar (h-9). */
const TOOLBAR_HEIGHT = 36;
/** h-7 */
const STATUS_BAR_HEIGHT = 28;

const TOTAL_TOP = TITLE_BAR_HEIGHT + TOOLBAR_HEIGHT;
const TOTAL_BOTTOM = STATUS_BAR_HEIGHT;

/** Full-window preview bounds, computed from the actual `BrowserWindow` content area — not the
 *  renderer's own DOM coords, which are unreliable on Windows (DPI scaling, window chrome offset). */
function fullWindowBounds(win: BrowserWindow): Rectangle {
  const winContent = win.getContentBounds();
  return {
    x: RAIL_WIDTH + GAP,
    y: TOTAL_TOP,
    width: winContent.width - RAIL_WIDTH - GAP,
    height: winContent.height - TOTAL_TOP - TOTAL_BOTTOM,
  };
}

let activeService: PreviewService | null = null;

export function registerPreviewHandlers(service: PreviewService, win: BrowserWindow | null): void {
  activeService = service;

  registerHandler('preview:detect', async () => {
    const result = await service.scanForDevServer();
    return { port: result?.port ?? null, url: result?.url ?? null };
  });

  registerHandler('preview:open', ({ url }) => {
    try {
      service.createView(DEFAULT_BOUNDS);
      // Immediately resize to correct bounds — DEFAULT_BOUNDS is just a placeholder.
      if (win !== null && !win.isDestroyed()) {
        service.resizeView(fullWindowBounds(win));
      }
      service.loadUrl(url);
      return { ok: true };
    } catch (error) {
      console.error('[preview] open failed:', error);
      return { ok: false };
    }
  });

  registerHandler('preview:close', () => {
    service.destroyView();
    return { ok: true };
  });

  registerHandler('preview:refresh', () => {
    service.refresh();
    return { ok: true };
  });

  registerHandler('preview:resize', ({ x, y, width, height }) => {
    // Renderer DOM coords + window.screenX/Y are unreliable on Windows (DPI scaling, window chrome
    // offset) — computed here from the actual window bounds instead.
    console.error('[preview:resize] renderer bounds:', { x, y, width, height });
    if (win === null || win.isDestroyed()) return;
    const winContent = win.getContentBounds();
    console.error('[preview:resize] window content bounds:', winContent);
    const previewBounds = {
      x: RAIL_WIDTH,
      y: Math.max(0, y),
      width: Math.max(100, winContent.width - RAIL_WIDTH),
      height: Math.max(100, winContent.height - Math.max(0, y)),
    };
    console.error('[preview:resize] final bounds:', previewBounds);
    service.resizeView(previewBounds);
  });

  registerHandler('preview:getState', () => service.getState());

  registerHandler('preview:checkDevScript', () => service.checkDevScript());

  registerHandler('preview:launchDevServer', () => service.launchDevServer());

  registerHandler('preview:launchAndPreview', ({ devCommand }) =>
    service.launchAndPreview(devCommand),
  );

  registerHandler('preview:hide', () => {
    service.hideView();
  });

  registerHandler('preview:show', () => {
    service.showView();
    // Resize to full window after showing.
    if (win !== null && !win.isDestroyed()) {
      service.resizeView(fullWindowBounds(win));
    }
  });
}

/** Called from `workspace.handlers.ts`'s `fs:writeFile` after a successful save — refreshes the
 *  embedded preview if one is open. A module-level reference rather than threading the service
 *  through workspace.handlers.ts's constructor, since this is the only thing it needs from it. */
export function notifyPreviewFileSaved(): void {
  activeService?.notifyFileSaved();
}
