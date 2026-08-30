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

let activeService: PreviewService | null = null;

export function registerPreviewHandlers(service: PreviewService): void {
  activeService = service;

  registerHandler('preview:detect', async () => {
    const result = await service.scanForDevServer();
    return { port: result?.port ?? null, url: result?.url ?? null };
  });

  registerHandler('preview:open', ({ url }) => {
    service.createView(DEFAULT_BOUNDS);
    service.loadUrl(url);
    return { ok: true };
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
    service.resizeView({ x, y, width, height });
  });

  registerHandler('preview:getState', () => service.getState());

  registerHandler('preview:checkDevScript', () => service.checkDevScript());

  registerHandler('preview:launchDevServer', () => service.launchDevServer());
}

/** Called from `workspace.handlers.ts`'s `fs:writeFile` after a successful save — refreshes the
 *  embedded preview if one is open. A module-level reference rather than threading the service
 *  through workspace.handlers.ts's constructor, since this is the only thing it needs from it. */
export function notifyPreviewFileSaved(): void {
  activeService?.notifyFileSaved();
}
