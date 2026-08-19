import type { AnalysisService } from '../../analysis/analysis-service.js';
import { createAnalysisWatcher, type AnalysisWatcher } from '../../analysis/watch-service.js';
import type { WorkspaceService } from '../../services/workspace-service.js';
import { emitToWindow } from '../emit.js';
import { registerHandler } from '../router.js';

/**
 * Analysis handlers (M3). `run`/`cancel` drive the isolated worker and need the window to stream
 * findings back to; `list`/`summary` read the persisted findings so the panel loads instantly and
 * survives a restart. The renderer never runs a tool — it asks main, which owns the workspace root,
 * vets the files, and owns the worker (ADR-017, Security §3).
 *
 * `watchStart`/`watchStop` are Watch Mode (off by default, Settings): main-owned so the renderer
 * never opens its own filesystem watcher — the same "main owns the workspace root" rule everything
 * else here already follows.
 */

// Module-scoped, like `workspace.handlers.ts`'s tree watcher: at most one Watch Mode session at a
// time, matching there being at most one open workspace at a time.
let watcher: AnalysisWatcher | null = null;

/** Called from `workspace.handlers.ts`'s `workspace:close` (and before opening a new root) — a
 * watcher outliving its workspace would keep re-analyzing files in a folder no longer open. */
export function stopAnalysisWatch(): void {
  void watcher?.close();
  watcher = null;
}

export function registerAnalysisHandlers(
  service: AnalysisService,
  workspaces: WorkspaceService,
): void {
  registerHandler('analysis:run', (_req, { window }) => {
    if (window !== null) service.run(window);
  });

  registerHandler('analysis:cancel', (_req, { window }) => {
    if (window !== null) service.cancel(window);
  });

  registerHandler('analysis:list', ({ filter }) => ({ findings: service.list(filter ?? {}) }));

  registerHandler('analysis:summary', () => service.summary());

  registerHandler('analysis:watchStart', (_req, { window }) => {
    stopAnalysisWatch();
    const open = workspaces.getCurrent();
    if (open === null) return { watching: false };

    watcher = createAnalysisWatcher(open.rootPath, open.ignore, (relPath) => {
      if (window === null || window.isDestroyed()) return;
      emitToWindow(window, 'analysis:watchEvent', { file: relPath, status: 'changed' });
      emitToWindow(window, 'analysis:watchEvent', { file: relPath, status: 'reanalyzing' });
      void service.analyzeFile(window, relPath).then(() => {
        if (!window.isDestroyed()) {
          emitToWindow(window, 'analysis:watchEvent', { file: relPath, status: 'done' });
        }
      });
    });
    return { watching: true };
  });

  registerHandler('analysis:watchStop', () => {
    stopAnalysisWatch();
  });
}
