import type { AnalysisService } from '../../analysis/analysis-service.js';
import { registerHandler } from '../router.js';

/**
 * Analysis handlers (M3). `run`/`cancel` drive the isolated worker and need the window to stream
 * findings back to; `list`/`summary` read the persisted findings so the panel loads instantly and
 * survives a restart. The renderer never runs a tool — it asks main, which owns the workspace root,
 * vets the files, and owns the worker (ADR-017, Security §3).
 */
export function registerAnalysisHandlers(service: AnalysisService): void {
  registerHandler('analysis:run', async (_req, { window }) => {
    if (window !== null) await service.run(window);
  });

  registerHandler('analysis:cancel', (_req, { window }) => {
    if (window !== null) service.cancel(window);
  });

  registerHandler('analysis:list', ({ filter }) => ({ findings: service.list(filter ?? {}) }));

  registerHandler('analysis:summary', () => service.summary());
}
