import { randomUUID } from 'node:crypto';
import { readdirSync, statSync } from 'node:fs';
import { join, posix } from 'node:path';

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
      void collectTargets(open).then(({ targets, skippedFiles }) => {
        // A workspace close/switch, or a newer run, may have superseded this one while the walk
        // was still yielding — starting the worker against a stale root would attribute the wrong
        // workspace's findings.
        if (deps.workspaces.getCurrent()?.id !== open.id) return;

        // Known as soon as the walk finishes — long before the first finding streams back — so the
        // status bar can show "Analyzing (N files)" rather than a bare, unchanging placeholder.
        emit(window, { status: 'running', totalCount: targets.length });

        // Collected in memory, not written per batch: `appendFindings` is one real SQLite
        // transaction (commit + fsync) per call, and the worker can flush hundreds of times on a
        // large project — hundreds of synchronous main-thread transactions was the actual freeze,
        // not any one of them being slow. One write in `onDone` below replaces all of them.
        const allFindings: Finding[] = [];

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
            allFindings.push(...findings);
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
            // to dedup against. Runs on `allFindings` (in memory) now, BEFORE the one and only DB
            // write — the previous version wrote every batch, then read the whole workspace back
            // from the DB, deduped, and wrote it AGAIN; that second read-clear-rewrite is gone, the
            // in-memory set was always right there.
            //
            // Dynamic import, not a static one: `@fixora/core-analysis` publishes ESM only (no
            // `require` entry), and this file is loaded by the CJS Electron main process — a static
            // `import { dedupeFindings } from '@fixora/core-analysis'` throws
            // ERR_PACKAGE_PATH_NOT_EXPORTED at startup, before the window ever opens. Same pattern as
            // `ai-service.ts`'s `groupByRootCause`/`widenRepairScope` and `analysis-host.ts`.
            // `onDone` itself must stay void-returning (the host's callback contract), so the async
            // work runs in a fire-and-forget IIFE rather than making this callback a Promise.
            void (async () => {
              const { dedupeFindings } = await import('@fixora/core-analysis');
              const { findings: deduped, duplicatesRemoved } = dedupeFindings(allFindings);
              if (duplicatesRemoved > 0) {
                log.info('[analysis] removed duplicate findings', {
                  workspaceId: open.id,
                  duplicatesRemoved,
                });
              }
              // The ONE write for this run — clear-then-insert, same as before, just once instead
              // of once per batch plus once more for dedup.
              deps.findings.clearWorkspace(open.id);
              deps.findings.appendFindings(open.id, deduped);
              emit(window, {
                status: 'done',
                summary: deps.findings.summary(open.id),
                ...(runWarnings !== undefined ? { warnings: runWarnings } : {}),
                ...(skippedFiles.length > 0 ? { skippedFiles } : {}),
              });
            })();
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

    /**
     * Watch Mode's entry point (watch-service.ts): re-analyze ONE file, not the whole project —
     * `run()` above always walks and re-vets every file, which is real work worth avoiding on
     * every keystroke-adjacent save. `replaceForFile`, not `appendFindings`: unlike a fresh full
     * run (which clears the whole workspace once, up front), this must replace only what this one
     * file owned, leaving every other file's findings untouched.
     */
    async analyzeFile(window: BrowserWindow | null, relPath: string): Promise<{ ok: boolean }> {
      const open = deps.workspaces.requireRoot();
      const target = targetFor(open, relPath);
      // Not analyzable (wrong language, ignored, secret-denied, or vanished) — nothing to do, and
      // nothing to clear either: a file that was never indexed never had findings to remove.
      if (target === null) return { ok: true };

      let receivedFindings = false;
      let ok = true;
      await new Promise<void>((resolve) => {
        deps.host.run({
          id: randomUUID(),
          workspaceRoot: open.rootPath,
          targets: [target],
          onFileFindings: (_file, findings) => {
            receivedFindings = true;
            deps.findings.replaceForFile(open.id, relPath, findings);
            if (window !== null && !window.isDestroyed()) {
              emitToWindow(window, 'analysis:findingsAdded', { findings });
            }
          },
          onNotice: () => {
            // A single-file re-analysis is too small a unit for the "analysis was partial"
            // banner `run()`'s warnings drive — a timed-out tool on one file is noise here.
          },
          onDone: () => {
            // No findings message arrived at all: the file is clean now (the worker only sends one
            // for a file that HAS findings), and that clean result must still land — otherwise a
            // fixed file keeps showing its stale, now-wrong findings forever.
            if (!receivedFindings) deps.findings.replaceForFile(open.id, relPath, []);
            // `window` is null for a headless MCP caller (no renderer to push progress to) —
            // the return value below is how that caller learns the outcome instead.
            if (window !== null && !window.isDestroyed()) {
              emit(window, { status: 'done', summary: deps.findings.summary(open.id) });
            }
            resolve();
          },
          onError: () => {
            ok = false;
            resolve();
          },
        });
      });
      return { ok };
    },
  };
}

export type AnalysisService = ReturnType<typeof createAnalysisService>;

const YIELD_EVERY = 200;
const yieldToEventLoop = (): Promise<void> =>
  new Promise((resolve) => {
    setImmediate(resolve);
  });

/** Is this path analyzable, and if so, its worker target? The same vetting `collectTargets`'s walk
 * applies inline, factored out so `analyzeFile` (Watch Mode) can ask it about one path without
 * walking the tree at all. */
export function targetFor(open: OpenWorkspace, relPath: string): AnalysisTargetRef | null {
  const language = detectLanguage(relPath);
  if (language === null || !isDeepLanguage(language)) return null;
  if (open.ignore.ignores(relPath) || isSecretPath(relPath)) return null;
  const absPath = join(open.rootPath, relPath);
  try {
    if (statSync(absPath).size > MAX_FILE_BYTES) return null;
  } catch {
    return null;
  }
  return { file: relPath, absPath, language };
}

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
/** How long a walk's result is trusted for the same root before repeating it — long enough to
 *  absorb back-to-back runs (a re-check right after opening, a retry) without another O(repo)
 *  walk, short enough that a walk started minutes ago never answers for the tree's current state. */
const TARGET_CACHE_TTL_MS = 30_000;
type CollectedTargets = { targets: AnalysisTargetRef[]; skippedFiles: string[] };
const targetCache = new Map<string, { result: CollectedTargets; expiresAt: number }>();

/** Whether `relPath` is otherwise analyzable — same checks `targetFor` applies, minus the size cap
 *  — so a walk can tell "skipped for being too large" apart from "skipped for any other reason"
 *  (wrong language, ignored, secret-denied) without duplicating `targetFor`'s own contract. */
function isAnalyzableIgnoringSize(open: OpenWorkspace, relPath: string): boolean {
  const language = detectLanguage(relPath);
  if (language === null || !isDeepLanguage(language)) return false;
  return !open.ignore.ignores(relPath) && !isSecretPath(relPath);
}

async function collectTargets(open: OpenWorkspace): Promise<CollectedTargets> {
  const cached = targetCache.get(open.rootPath);
  if (cached !== undefined && cached.expiresAt > Date.now()) return cached.result;

  const targets: AnalysisTargetRef[] = [];
  const skippedFiles: string[] = [];

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
      const target = targetFor(open, relPath);
      if (target !== null) {
        targets.push(target);
      } else if (isAnalyzableIgnoringSize(open, relPath)) {
        try {
          if (statSync(join(open.rootPath, relPath)).size > MAX_FILE_BYTES) {
            skippedFiles.push(relPath);
          }
        } catch {
          // Vanished mid-walk — not a size skip, nothing to report.
        }
      }
      if (targets.length % YIELD_EVERY === 0) await yieldToEventLoop();
    }
  };

  await walk('');
  const result: CollectedTargets = { targets, skippedFiles };
  targetCache.set(open.rootPath, { result, expiresAt: Date.now() + TARGET_CACHE_TTL_MS });
  return result;
}
