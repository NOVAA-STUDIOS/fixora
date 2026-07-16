import { randomUUID } from 'node:crypto';
import { readdirSync, statSync } from 'node:fs';
import { join, posix } from 'node:path';

import type { AnalysisState, Finding, FindingsFilter } from '@fixora/shared-types';
import type { BrowserWindow } from 'electron';

import type { FindingsRepository } from '../db/repositories.js';
import { emitToWindow } from '../ipc/emit.js';
import { detectLanguage, isDeepLanguage } from '../services/fs/language.js';
import { isSecretPath } from '../services/fs/secrets-denylist.js';
import type { OpenWorkspace, WorkspaceService } from '../services/workspace-service.js';

import type { AnalysisHost, AnalysisTargetRef } from './analysis-host.js';

/**
 * Orchestrates an analysis run on the main side (M3). It owns the trust boundary the worker does
 * not: it enumerates only files that are analyzable, not ignored, not secret, and inside the
 * workspace (Security §3), then hands those vetted targets to the isolated worker (ADR-017). Findings
 * stream back per file — each batch is persisted (so the panel survives a restart) and pushed to the
 * renderer — and the run ends by broadcasting the grouped summary.
 */

const MAX_FILE_BYTES = 2 * 1024 * 1024; // skip files too large to analyze cheaply

export interface AnalysisServiceDeps {
  workspaces: WorkspaceService;
  findings: FindingsRepository;
  host: AnalysisHost;
}

export function createAnalysisService(deps: AnalysisServiceDeps) {
  function emit(window: BrowserWindow, state: AnalysisState): void {
    if (!window.isDestroyed()) emitToWindow(window, 'analysis:state', state);
  }

  return {
    run(window: BrowserWindow): void {
      const open = deps.workspaces.requireRoot();
      const targets = collectTargets(open);

      emit(window, { status: 'running' });

      // Capability detection and all engine work happen in the isolated worker (ADR-017); main only
      // hands over the vetted targets. This keeps the ESM engine (and its WASM) out of the CJS main.
      deps.host.run({
        id: randomUUID(),
        workspaceRoot: open.rootPath,
        targets,
        onFileFindings: (file, findings) => {
          deps.findings.replaceForFile(open.id, file, findings);
          if (!window.isDestroyed() && findings.length > 0) {
            emitToWindow(window, 'analysis:findingsAdded', { findings });
          }
        },
        onDone: () => {
          emit(window, { status: 'done', summary: deps.findings.summary(open.id) });
        },
        onError: (message) => {
          emit(window, { status: 'error', message });
        },
      });
    },

    cancel(window: BrowserWindow): void {
      deps.host.cancel();
      emit(window, { status: 'idle' });
    },

    list(filter: FindingsFilter): Finding[] {
      const open = deps.workspaces.requireRoot();
      return deps.findings.list(open.id, filter);
    },

    summary() {
      const open = deps.workspaces.requireRoot();
      return deps.findings.summary(open.id);
    },
  };
}

export type AnalysisService = ReturnType<typeof createAnalysisService>;

/**
 * Every analyzable file in the workspace: a language we support, not ignored, not secret, not
 * oversized, and inside the root. This is the same walk the indexer uses, filtered to what the
 * engine can act on — and it is where the path guard's guarantees are applied before a path is
 * handed to the (less privileged) worker.
 */
function collectTargets(open: OpenWorkspace): AnalysisTargetRef[] {
  const targets: AnalysisTargetRef[] = [];

  const walk = (relDir: string): void => {
    let entries;
    try {
      entries = readdirSync(join(open.rootPath, relDir), { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const relPath = relDir === '' ? entry.name : posix.join(relDir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (!open.ignore.ignores(`${relPath}/`)) walk(relPath);
        continue;
      }
      if (!entry.isFile()) continue;
      const language = detectLanguage(relPath);
      if (language === null || !isDeepLanguage(language)) continue;
      if (open.ignore.ignores(relPath) || isSecretPath(relPath)) continue;
      const absPath = join(open.rootPath, relPath);
      try {
        if (statSync(absPath).size > MAX_FILE_BYTES) continue;
      } catch {
        continue;
      }
      targets.push({ file: relPath, absPath, language });
    }
  };

  walk('');
  return targets;
}
