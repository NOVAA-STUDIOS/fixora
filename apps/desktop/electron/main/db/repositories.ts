import { randomUUID } from 'node:crypto';

import type { Row, SqliteDriver } from './driver.js';

/**
 * Repositories: the only code that writes SQL against the schema. A service asks a repository for
 * domain objects; it never holds a statement or a row. Ids are client-generated UUIDs (DB §5, so a
 * future sync has stable keys), and timestamps are epoch-millis integers (never floats).
 */

export type Workspace = {
  id: string;
  rootPath: string;
  name: string;
  lastOpenedAt: number;
  settingsJson: string;
  createdAt: number;
};

export type FileRecord = {
  id: string;
  workspaceId: string;
  relPath: string;
  language: string | null;
  sizeBytes: number;
  mtime: number;
  contentHash: string | null;
  indexedAt: number;
};

function toWorkspace(row: Row): Workspace {
  return {
    id: row['id'] as string,
    rootPath: row['root_path'] as string,
    name: row['name'] as string,
    lastOpenedAt: row['last_opened_at'] as number,
    settingsJson: row['settings_json'] as string,
    createdAt: row['created_at'] as number,
  };
}

export function createWorkspaceRepository(driver: SqliteDriver, now: () => number = Date.now) {
  return {
    /** Insert on first open, or bump `last_opened_at` on re-open. Keyed by the unique root path. */
    upsertByRootPath(rootPath: string, name: string): Workspace {
      const existing = driver
        .prepare('SELECT * FROM workspaces WHERE root_path = ?')
        .get(rootPath);
      const ts = now();
      if (existing !== undefined) {
        driver
          .prepare('UPDATE workspaces SET last_opened_at = ?, name = ? WHERE root_path = ?')
          .run(ts, name, rootPath);
        return toWorkspace({ ...existing, last_opened_at: ts, name });
      }
      const id = randomUUID();
      driver
        .prepare(
          `INSERT INTO workspaces (id, root_path, name, last_opened_at, settings_json, created_at)
           VALUES (?, ?, ?, ?, '{}', ?)`,
        )
        .run(id, rootPath, name, ts, ts);
      return {
        id,
        rootPath,
        name,
        lastOpenedAt: ts,
        settingsJson: '{}',
        createdAt: ts,
      };
    },

    /** Recent workspaces, most-recently-opened first — what the "open recent" list reads. */
    recent(limit = 10): Workspace[] {
      return driver
        .prepare('SELECT * FROM workspaces ORDER BY last_opened_at DESC LIMIT ?')
        .all(limit)
        .map(toWorkspace);
    },

    findByRootPath(rootPath: string): Workspace | undefined {
      const row = driver.prepare('SELECT * FROM workspaces WHERE root_path = ?').get(rootPath);
      return row === undefined ? undefined : toWorkspace(row);
    },

    remove(id: string): void {
      driver.prepare('DELETE FROM workspaces WHERE id = ?').run(id);
    },
  };
}

export type WorkspaceRepository = ReturnType<typeof createWorkspaceRepository>;

export function createFileIndexRepository(driver: SqliteDriver, now: () => number = Date.now) {
  return {
    /** Replace a workspace's file index in one transaction — the indexer produces the whole set. */
    replaceAll(workspaceId: string, files: Omit<FileRecord, 'id' | 'workspaceId' | 'indexedAt'>[]): void {
      const ts = now();
      driver.transaction(() => {
        driver.prepare('DELETE FROM files_index WHERE workspace_id = ?').run(workspaceId);
        const insert = driver.prepare(
          `INSERT INTO files_index
             (id, workspace_id, rel_path, language, size_bytes, mtime, content_hash, indexed_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        );
        for (const f of files) {
          insert.run(
            randomUUID(),
            workspaceId,
            f.relPath,
            f.language,
            f.sizeBytes,
            f.mtime,
            f.contentHash,
            ts,
          );
        }
      });
    },

    countForWorkspace(workspaceId: string): number {
      const row = driver
        .prepare('SELECT COUNT(*) AS n FROM files_index WHERE workspace_id = ?')
        .get(workspaceId);
      return (row?.['n'] as number | undefined) ?? 0;
    },
  };
}

export type FileIndexRepository = ReturnType<typeof createFileIndexRepository>;
