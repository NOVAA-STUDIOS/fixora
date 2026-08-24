import type { CodeShieldReport } from '@fixora/shared-types';

import { getShieldSettings, saveShieldSettings } from '../../lib/shield-settings.js';
import type { ShieldService } from '../../services/shield/shield-service.js';
import type { WorkspaceService } from '../../services/workspace-service.js';
import { registerHandler } from '../router.js';

/**
 * Code Shield's IPC surface. The Shield auto-triggers on file open and on save, so the throttle
 * below is not politeness — without it, a save-heavy session would re-run the full analyzer set on
 * the same file dozens of times a minute for no new information.
 */

const MIN_INTERVAL_MS = 10_000;

/**
 * Keyed by `${workspaceRoot}::${relPath}`, not the bare path — two different projects can share a
 * relative path (`src/index.ts` exists in nearly every one), and a bare-path cache would hand a
 * freshly opened project the PREVIOUS project's cached report for that path.
 */
function cacheKey(workspaceRoot: string, filePath: string): string {
  return `${workspaceRoot}::${filePath}`;
}

/** Last accepted analysis per (workspace, file). Module state, matching the one-workspace-at-a-time
 *  assumption every other main-side cache here makes — cleared wholesale on workspace switch. */
const lastAnalyzedAt = new Map<string, number>();

/** The most recent report per (workspace, file), so a throttled call returns the real previous
 *  result rather than a placeholder — the panel must never render a score that was not measured. */
const lastReport = new Map<string, CodeShieldReport>();

/** Test seam, and also called on every workspace open/close (`workspace.handlers.ts`) — a cache
 *  entry from the PREVIOUS workspace must never answer a request in the new one. */
export function resetShieldThrottle(): void {
  lastAnalyzedAt.clear();
  lastReport.clear();
}

export function registerShieldHandlers(deps: {
  shield: ShieldService;
  workspace: WorkspaceService;
}): void {
  registerHandler('shield:analyze', async ({ filePath }, { window }) => {
    const disabled = (reason: string): CodeShieldReport => ({
      score: null,
      critical: [],
      warnings: [],
      passed: [],
      prReadiness: 'not-ready',
      analyzedAt: Date.now(),
      file: filePath,
      error: reason,
    });

    const settings = getShieldSettings();
    if (!settings.enabled) return disabled('Code Shield is turned off in Settings.');
    if (window === null) return disabled('No window is available to run analysis against.');

    const open = deps.workspace.getCurrent();
    if (open === null) return disabled('No project is open.');
    const key = cacheKey(open.rootPath, filePath);

    const now = Date.now();
    const previous = lastAnalyzedAt.get(key);
    if (previous !== undefined && now - previous < MIN_INTERVAL_MS) {
      // Within the throttle window: return the last REAL report for this file if we have one.
      // Never a fresh-looking zero — that would read as "your file just got worse".
      const cached = lastReport.get(key);
      if (cached !== undefined) return cached;
    }
    lastAnalyzedAt.set(key, now);

    const report = await deps.shield.analyzeFile(window, filePath, settings.sensitivity);
    // Only a successful run is cached — an error must not be replayed for the next 10 seconds.
    if (report.error === null) lastReport.set(key, report);
    return report;
  });

  registerHandler('shield:getSettings', () => getShieldSettings());

  registerHandler('shield:saveSettings', (next) => saveShieldSettings(next));
}
