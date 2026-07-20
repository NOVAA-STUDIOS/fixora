import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join, posix } from 'node:path';

import type { FileIndexRepository, Workspace, WorkspaceRepository } from '../db/repositories.js';

import { loadIgnoreRules, type IgnoreMatcher } from './fs/ignore-rules.js';
import { detectLanguage } from './fs/language.js';
import { assertInsideWorkspace } from './fs/path-guard.js';

/**
 * The workspace service holds the **trusted** current-workspace state in the main process. The
 * renderer never sends the root path or an absolute path — it sends workspace-relative paths, and
 * this service pairs them with the root it owns. Opening a workspace is the only way the root is
 * set, and it comes from a native folder dialog or a stored recent, never from a renderer string.
 */

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
      const stat = statSync(rootPath); // throws if the path does not exist
      if (!stat.isDirectory()) {
        throw new Error('A workspace must be a folder.');
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
      if (current === null) throw new Error('No workspace is open.');
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
     */
    indexFiles(workspace: OpenWorkspace, maxFiles = 50_000): number {
      const records: Parameters<FileIndexRepository['replaceAll']>[1] = [];

      const walk = (relDir: string): void => {
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
            walk(childRel);
          } else if (entry.isFile()) {
            if (workspace.ignore.ignores(childRel)) continue;
            const abs = join(workspace.rootPath, childRel);
            try {
              const stat = statSync(abs);
              records.push({
                relPath: childRel,
                language: detectLanguage(entry.name),
                sizeBytes: stat.size,
                mtime: Math.floor(stat.mtimeMs),
                contentHash: hashFile(abs, stat.size),
              });
            } catch {
              // vanished between readdir and stat — skip
            }
          }
        }
      };

      walk('');
      deps.files.replaceAll(workspace.id, records);
      return records.length;
    },
  };
}

export type WorkspaceService = ReturnType<typeof createWorkspaceService>;

/** Content hash — the analysis cache key and patch conflict key (DB §1). Skipped for huge files. */
function hashFile(absolute: string, size: number): string | null {
  if (size > 4 * 1024 * 1024) return null; // do not read multi-MB files just to hash them at index time
  try {
    return createHash('sha256').update(readFileSync(absolute)).digest('hex');
  } catch {
    return null;
  }
}
