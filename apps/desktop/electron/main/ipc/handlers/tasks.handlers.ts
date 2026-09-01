import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { WorkspaceService } from '../../services/workspace-service.js';
import { registerHandler } from '../router.js';

/**
 * Tasks Runner: every script in the open workspace's package.json, surfaced for the Packages
 * panel's "Scripts" tab. Reading only — running one is the renderer's own job, through the real
 * Terminal tab (`useTerminalStore`'s `openWithCommand`), the same "main never runs a package
 * manager on the renderer's say-so without the user seeing exactly what ran" posture
 * `packages-panel.tsx`'s existing install/uninstall commands already follow.
 */

type PackageManager = 'pnpm' | 'yarn' | 'npm';

function detectPackageManager(root: string): PackageManager {
  if (existsSync(join(root, 'pnpm-lock.yaml'))) return 'pnpm';
  if (existsSync(join(root, 'yarn.lock'))) return 'yarn';
  return 'npm';
}

export function registerTasksHandlers(workspace: WorkspaceService): void {
  registerHandler('tasks:list', async () => {
    const open = workspace.getCurrent();
    if (open === null) return { scripts: {}, packageManager: 'npm' as const };

    const packageManager = detectPackageManager(open.rootPath);
    try {
      const pkg = JSON.parse(await readFile(join(open.rootPath, 'package.json'), 'utf8')) as {
        scripts?: unknown;
      };
      const rawScripts =
        typeof pkg.scripts === 'object' && pkg.scripts !== null
          ? (pkg.scripts as Record<string, unknown>)
          : {};
      const scripts: Record<string, string> = {};
      for (const [name, command] of Object.entries(rawScripts)) {
        if (typeof command === 'string') scripts[name] = command;
      }
      return { scripts, packageManager };
    } catch {
      // Missing or unparsable package.json — no scripts to offer, not an error to surface.
      return { scripts: {}, packageManager };
    }
  });
}
