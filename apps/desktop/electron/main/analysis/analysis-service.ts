import { randomUUID } from 'node:crypto';
import { readdirSync, statSync } from 'node:fs';
import { join, posix } from 'node:path';

import { dedupeFindings } from '@fixora/core-analysis';
import type { AnalysisState, AnalysisWarning, Finding, FindingsFilter } from '@fixora/shared-types';
import type { BrowserWindow } from 'electron';
import log from 'electron-log';

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
      emit(window, { status: 'running' });

      // Enumerating targets is itself an O(repo) walk (readdir/stat every file) — on a 100k+ file
      // project this held main's event loop for the whole walk before the worker job was even
      // sent, the same freeze `workspace-service.ts`'s indexFiles had. `collectTargets` now yields
      // like that fix does, so this await is real background time, not one long synchronous call.
      void collectTargets(open).then((targets) => {
        // A workspace close/switch, or a newer run, may have superseded this one while the walk
        // was still yielding — starting the worker against a stale root would attribute the wrong
        // workspace's findings.
        if (deps.workspaces.getCurrent()?.id !== open.id) return;

        // A fresh run supersedes the previous one. Clear first, then persist per file as results
        // arrive — so a file that no longer has findings correctly ends up empty (the worker sends
        // no message for a clean file).
        deps.findings.clearWorkspace(open.id);

        // Streamed as findings arrive, so a long run on a large project shows proof of life instead
        // of the static "Analyzing…" placeholder sitting unchanged for minutes.
        let findingsSoFar = 0;
        // Reliability warnings (NOV7-01): tools killed at their timeout. Captured here so the final
        // `done` state carries them — the panel must not present a partial analysis as complete.
        let runWarnings: AnalysisWarning[] | undefined;

        // Capability detection and all engine work happen in the isolated worker (ADR-017); main
        // only hands over the vetted targets. This keeps the ESM engine (and its WASM) out of main.
        deps.host.run({
          id: randomUUID(),
          workspaceRoot: open.rootPath,
          targets,
          onFileFindings: (_file, findings) => {
            // Insert-only (not replaceForFile): the worker now streams a file's findings across
            // possibly several flushes rather than one message per file, and a delete-then-insert
            // per flush would let a later batch erase an earlier one's rows for the same file. Safe
            // here because clearWorkspace() above already emptied the workspace once for this run.
            deps.findings.appendFindings(open.id, findings);
            if (!window.isDestroyed() && findings.length > 0) {
              emitToWindow(window, 'analysis:findingsAdded', { findings });
              findingsSoFar += findings.length;
              emit(window, { status: 'running', findingsSoFar });
            }
          },
          onNotice: (warnings) => {
            // Reliability notices (NOV7-01): an external tool was killed at its timeout. Surfaced on
            // the final state so the panel can show "analysis is partial" instead of a clean bill.
            runWarnings = warnings;
            if (!window.isDestroyed()) emit(window, { status: 'running', warnings });
          },
          onDone: () => {
            // Cross-analyzer dedup, once the full set exists — not per `onFileFindings` batch: two
            // tools flagging the same line can arrive in separate flushes (analyzers stream
            // independently, see engine.ts's merge()), so no single batch is ever "complete" enough
            // to dedup against. This is the one point a full, final set genuinely exists.
            const { findings: deduped, duplicatesRemoved } = dedupeFindings(
              deps.findings.list(open.id, {}),
            );
            if (duplicatesRemoved > 0) {
              log.info('[analysis] removed duplicate findings', {
                workspaceId: open.id,
                duplicatesRemoved,
              });
              deps.findings.clearWorkspace(open.id);
              deps.findings.appendFindings(open.id, deduped);
            }
            emit(window, {
              status: 'done',
              summary: deps.findings.summary(open.id),
              ...(runWarnings !== undefined ? { warnings: runWarnings } : {}),
            });
          },
          onError: (message) => {
            emit(window, { status: 'error', message });
          },
        });
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

const YIELD_EVERY = 200;
const yieldToEventLoop = (): Promise<void> =>
  new Promise((resolve) => {
    setImmediate(resolve);
  });

/**
 * Every analyzable file in the workspace: a language we support, not ignored, not secret, not
 * oversized, and inside the root. This is the same walk the indexer uses, filtered to what the
 * engine can act on — and it is where the path guard's guarantees are applied before a path is
 * handed to the (less privileged) worker.
 *
 * Yields to the event loop every `YIELD_EVERY` files, the same fix `workspace-service.ts`'s
 * `indexFiles` applies — a synchronous walk over a 100k+ file repo (each entry a readdir/stat)
 * held main's event loop, including every pending IPC call, for the walk's whole duration.
 */
async function collectTargets(open: OpenWorkspace): Promise<AnalysisTargetRef[]> {
  const targets: AnalysisTargetRef[] = [];

  const walk = async (relDir: string): Promise<void> => {
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
        if (!open.ignore.ignores(`${relPath}/`)) await walk(relPath);
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
      if (targets.length % YIELD_EVERY === 0) await yieldToEventLoop();
    }
  };

  await walk('');
  return targets;
}
