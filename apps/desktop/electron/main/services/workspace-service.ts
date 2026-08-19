import { readdirSync, statSync } from 'node:fs';
import { basename, extname, join, posix } from 'node:path';

import { UserFacingError } from '@fixora/shared-types';

import type { FileIndexRepository, Workspace, WorkspaceRepository } from '../db/repositories.js';

import { fsTry } from './fs/fs-errors.js';
import { loadIgnoreRules, type IgnoreMatcher } from './fs/ignore-rules.js';
import { detectLanguage, SOURCE_EXTENSIONS } from './fs/language.js';
import { assertInsideWorkspace } from './fs/path-guard.js';

/**
 * The workspace service holds the **trusted** current-workspace state in the main process. The
 * renderer never sends the root path or an absolute path — it sends workspace-relative paths, and
 * this service pairs them with the root it owns. Opening a workspace is the only way the root is
 * set, and it comes from a native folder dialog or a stored recent, never from a renderer string.
 */

/** Past this many indexed files, `indexFiles` keeps only source files (SOURCE_EXTENSIONS) — see
 * its own doc comment for why. */
const MAX_INDEX_FILES = 50_000;

export type OpenWorkspace = {
  id: string;
  rootPath: string;
  name: string;
  ignore: IgnoreMatcher;
};

export type WorkspaceServiceDeps = {
  workspaces: WorkspaceRepository;
  files: FileIndexRepository;
};

export function createWorkspaceService(deps: WorkspaceServiceDeps) {
  let current: OpenWorkspace | null = null;
  // Paths the user chose through the native folder picker this session. The renderer is treated as
  // hostile (invariant I1): it may send any string to `workspace:open`, so main must not turn an
  // arbitrary renderer-supplied path into the trusted FS root. A path is openable-from-the-renderer
  // only if the user actually picked it (this set) or it is already a known recent (which itself
  // only ever got there through a prior pick). Internal callers (restoreLast, indexing, tests) use
  // `open()` directly and are already trusted; the check lives at the IPC boundary, via `authorize`
  // + `isUserAuthorized`.
  const pickedThisSession = new Set<string>();

  return {
    /** Record a path the user selected in the native folder dialog as authorized to open. */
    authorize(rootPath: string): void {
      pickedThisSession.add(rootPath);
    },

    /**
     * Whether a renderer-supplied path may be opened: it was picked this session, or it is a known
     * recent. Anything else is a fabricated path from a hostile renderer and must be refused.
     */
    isUserAuthorized(rootPath: string): boolean {
      return (
        pickedThisSession.has(rootPath) || deps.workspaces.findByRootPath(rootPath) !== undefined
      );
    },

    /**
     * Open a folder as the workspace. Validates it is a real directory, records/bumps it in the
     * recents (DB), loads its ignore rules, and becomes the current workspace. Returns the record
     * plus the root directory's immediate children for the tree's first paint.
     */
    open(rootPath: string): { workspace: Workspace } {
      // Routed through the same fs-error translation layer `fs:listDir`/`fs:readFile`/etc. use
      // (fs-errors.ts), rather than letting a raw ENOENT/EACCES/etc. reach the router's generic
      // "Something went wrong handling that action." — the previous bare `statSync` call did
      // exactly that for a deleted, moved, or renamed recent project (beta audit A2, Recent
      // Projects finding). `basename`, not `rootPath`, in the message: an absolute path is user
      // data (Security §9) and must not cross to the renderer even in an error string.
      const stat = fsTry('open', basename(rootPath) || rootPath, () => statSync(rootPath));
      if (!stat.isDirectory()) {
        throw new UserFacingError(
          'That path is not a folder, so it cannot be opened as a project.',
          {
            code: 'not_a_folder',
            stage: 'workspace',
          },
        );
      }
      const name = basename(rootPath) || rootPath;
      const record = deps.workspaces.upsertByRootPath(rootPath, name);
      current = {
        id: record.id,
        rootPath: record.rootPath,
        name: record.name,
        ignore: loadIgnoreRules(record.rootPath),
      };
      return { workspace: record };
    },

    /**
     * Close the workspace: main forgets the trusted root, so every path-guarded handler goes back to
     * refusing. The recents row stays (that is the point of recents) but the *authorization* to open
     * it again comes from that row, not from this session — closing must not widen what the renderer
     * can reach. The watcher is stopped by the handler that owns it.
     */
    close(): void {
      current = null;
    },

    /** The current workspace, or null if none is open. FS handlers read the root from here. */
    getCurrent(): OpenWorkspace | null {
      return current;
    },

    /** The root path, asserted present — for handlers that only run when a workspace is open. */
    requireRoot(): OpenWorkspace {
      if (current === null) {
        // Authored, not generic. Every analysis and fs channel funnels through here, so this one
        // line was the single largest producer of "Something went wrong handling that action." —
        // a condition the user can act on, reported as an unexplained failure.
        throw new UserFacingError('No project is open. Open a folder first, then run analysis.', {
          code: 'no_workspace',
          action: { type: 'none', label: 'Dismiss' },
          stage: 'workspace',
        });
      }
      return current;
    },

    recent(limit?: number): Workspace[] {
      return deps.workspaces.recent(limit);
    },

    /**
     * Forget one recent, or all of them. This is a bookmark list: removing an entry deletes a row
     * and nothing else — the folder on disk is never touched. It also *de-authorizes* the path,
     * because "is a known recent" is one of the two things that make a renderer-supplied path
     * openable; a forgotten project must go back to requiring a real pick.
     */
    removeRecent(id: string): void {
      const row = deps.workspaces.recent(1000).find((w) => w.id === id);
      if (row !== undefined) pickedThisSession.delete(row.rootPath);
      deps.workspaces.remove(id);
    },

    clearRecent(): void {
      pickedThisSession.clear();
      deps.workspaces.removeAll();
    },

    /** Pin or unpin a recent project (Sprint F2) — a list-ordering preference, not a security fact. */
    setPinned(id: string, pinned: boolean): void {
      deps.workspaces.setPinned(id, pinned);
    },

    /**
     * Re-open the most recent workspace whose folder still exists (like an IDE reopening your last
     * project). A recent whose folder was deleted or moved is skipped, not an error. Returns the
     * reopened workspace, or null if there is nothing to restore.
     */
    restoreLast(): Workspace | null {
      for (const candidate of deps.workspaces.recent(5)) {
        try {
          if (statSync(candidate.rootPath).isDirectory()) {
            return this.open(candidate.rootPath).workspace;
          }
        } catch {
          // folder gone — try the next recent
        }
      }
      return null;
    },

    /**
     * Walk the whole tree once and write the file index (content hashes, languages, sizes). Runs
     * ignore-aware and off the first-paint path — the tree renders from lazy `listDirectory`
     * calls; this index feeds M3's analysis, so it can take its time in the background. Returns the
     * number of files indexed. Symlinked directories are not descended (loop-safe, and the guard
     * would reject them anyway).
     *
     * Yields to the event loop every `YIELD_EVERY` files (`setImmediate`) instead of walking the
     * whole tree in one synchronous call. A 50k-file repo hashed in one go held the main process's
     * event loop for seconds — during which every pending IPC call stalls, including the
     * `fs:listDir` calls the tree's own first paint depends on. Chunking keeps main responsive
     * without the complexity of moving this into the analysis worker process.
     */
    // Raised from 50k: a large monorepo's real, non-ignored file count can exceed that, and the
    // walk itself yields (see YIELD_EVERY below), so the ceiling is no longer what protects main's
    // responsiveness — this is now purely a sanity bound against pathological input.
    async indexFiles(workspace: OpenWorkspace, maxFiles = 200_000): Promise<number> {
      // Shorter, more frequent yields: a burst of 200 files (each with a full-content SHA256 read)
      // saturated main's event loop for long enough to make every other IPC call sluggish for the
      // burst's duration. 50 is a quarter the work per burst, four times as many breathing points.
      const YIELD_EVERY = 50;
      // Past this many files, memory (not event-loop responsiveness — YIELD_EVERY already handles
      // that) becomes the concern: one index record per file, held for the workspace's lifetime.
      // A 100k+-file project pushes that into hundreds of MB. Past the threshold, only files worth
      // analyzing are kept — a `node_modules`-sized pile of assets was never useful in this index
      // anyway, since analysis only ever runs on Fixora's supported languages.
      const records: Parameters<FileIndexRepository['replaceAll']>[1] = [];
      let cappedWarned = false;
      // A `setImmediate` alone only guarantees a queue turn, not that other pending work (an IPC
      // reply, a paint) actually gets serviced before the next burst starts — this small delay gives
      // it room to.
      const yieldToEventLoop = (): Promise<void> =>
        new Promise((resolve) => {
          setTimeout(resolve, 4);
        });

      const walk = async (relDir: string): Promise<void> => {
        if (records.length >= maxFiles) return;
        let entries;
        try {
          entries = readdirSync(
            assertInsideWorkspace(join(workspace.rootPath, relDir), workspace.rootPath),
            {
              withFileTypes: true,
            },
          );
        } catch {
          return; // unreadable dir — skip, do not abort the whole index
        }
        for (const entry of entries) {
          if (records.length >= maxFiles) return;
          const childRel = relDir === '' ? entry.name : posix.join(relDir, entry.name);
          if (entry.isSymbolicLink()) continue;
          if (entry.isDirectory()) {
            if (workspace.ignore.ignores(`${childRel}/`)) continue;
            await walk(childRel);
          } else if (entry.isFile()) {
            if (workspace.ignore.ignores(childRel)) continue;
            if (childRel.endsWith('.min.js') || childRel.endsWith('.map')) continue;
            if (records.length >= MAX_INDEX_FILES && !SOURCE_EXTENSIONS.has(extname(childRel))) {
              if (!cappedWarned) {
                cappedWarned = true;
                console.warn('[workspace] large project — indexing capped at 50k files', {
                  workspaceId: workspace.id,
                });
              }
              continue;
            }
            const abs = join(workspace.rootPath, childRel);
            try {
              const stat = statSync(abs);
              records.push({
                relPath: childRel,
                language: detectLanguage(entry.name),
                sizeBytes: stat.size,
                mtime: Math.floor(stat.mtimeMs),
                contentHash: fileChangeKey(stat.mtimeMs, stat.size),
              });
            } catch {
              // vanished between readdir and stat — skip
            }
            if (records.length % YIELD_EVERY === 0) await yieldToEventLoop();
          }
        }
      };

      await walk('');
      deps.files.replaceAll(workspace.id, records);
      return records.length;
    },
  };
}

export type WorkspaceService = ReturnType<typeof createWorkspaceService>;

/**
 * A cheap change-detection key for `files_index.content_hash`. Was a SHA256 of the full file
 * content — the single most expensive step of indexing (a synchronous read of every file), for a
 * column verified unread by any current caller (no query or comparison against it exists anywhere
 * in the codebase; `core-analysis`'s own `hashSource` cache reads content independently during
 * analysis, not from this table). `mtime` + `size` is the same trade `git status` and most file
 * watchers make: nearly always sufficient, and immeasurably cheaper than reading every byte.
 */
function fileChangeKey(mtimeMs: number, size: number): string {
  return `${String(mtimeMs)}-${String(size)}`;
}
