import { randomUUID } from 'node:crypto';

import type {
  Finding,
  FindingSource,
  FindingsFilter,
  FindingsSummary,
  Severity,
} from '@fixora/shared-types';

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
      const existing = driver.prepare('SELECT * FROM workspaces WHERE root_path = ?').get(rootPath);
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
    replaceAll(
      workspaceId: string,
      files: Omit<FileRecord, 'id' | 'workspaceId' | 'indexedAt'>[],
    ): void {
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

export function createFindingsRepository(driver: SqliteDriver, now: () => number = Date.now) {
  return {
    /**
     * Replace all findings for one file in one transaction — analysis is incremental and re-runs a
     * file at a time (TDD §5.2), so a fresh run for a path atomically supersedes the previous one.
     * `OR REPLACE` collapses the rare case of two identical findings sharing a stable id in one batch.
     */
    replaceForFile(workspaceId: string, relPath: string, findings: readonly Finding[]): void {
      const ts = now();
      driver.transaction(() => {
        driver
          .prepare('DELETE FROM findings WHERE workspace_id = ? AND rel_path = ?')
          .run(workspaceId, relPath);
        const insert = driver.prepare(
          `INSERT OR REPLACE INTO findings
             (id, workspace_id, finding_id, rel_path, source, rule_id, severity, category,
              start_line, start_col, end_line, end_col, message, fixable, confidence, data_json, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        );
        for (const f of findings) {
          insert.run(
            randomUUID(),
            workspaceId,
            f.id,
            f.location.file,
            f.source,
            f.ruleId,
            f.severity,
            f.category,
            f.location.startLine,
            f.location.startCol,
            f.location.endLine,
            f.location.endCol,
            f.message,
            f.fixable ? 1 : 0,
            f.confidence,
            JSON.stringify(f),
            ts,
          );
        }
      });
    },

    /** Findings for a workspace, most-severe-then-file order, optionally filtered and paged. */
    list(workspaceId: string, filter: FindingsFilter = {}, limit = 500, offset = 0): Finding[] {
      const where: string[] = ['workspace_id = ?'];
      const params: (string | number)[] = [workspaceId];
      if (filter.severity !== undefined) {
        where.push('severity = ?');
        params.push(filter.severity);
      }
      if (filter.source !== undefined) {
        where.push('source = ?');
        params.push(filter.source);
      }
      if (filter.relPath !== undefined) {
        where.push('rel_path = ?');
        params.push(filter.relPath);
      }
      params.push(limit, offset);
      return driver
        .prepare(
          `SELECT data_json FROM findings WHERE ${where.join(' AND ')}
             ORDER BY
               CASE severity WHEN 'error' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,
               rel_path, start_line
             LIMIT ? OFFSET ?`,
        )
        .all(...params)
        .map((row) => JSON.parse(row['data_json'] as string) as Finding);
    },

    /** One finding by its stable id — what an AI action loads to ground itself (M5). */
    getByFindingId(workspaceId: string, findingId: string): Finding | null {
      const row = driver
        .prepare(
          'SELECT data_json FROM findings WHERE workspace_id = ? AND finding_id = ? LIMIT 1',
        )
        .get(workspaceId, findingId);
      return row === undefined ? null : (JSON.parse(row['data_json'] as string) as Finding);
    },

    /** Grouped counts for the panel header — computed in SQL, never by loading rows. */
    summary(workspaceId: string): FindingsSummary {
      const bySeverity: Record<Severity, number> = { error: 0, warning: 0, info: 0 };
      for (const row of driver
        .prepare(
          'SELECT severity, COUNT(*) AS n FROM findings WHERE workspace_id = ? GROUP BY severity',
        )
        .all(workspaceId)) {
        const key = row['severity'] as Severity;
        if (key in bySeverity) bySeverity[key] = row['n'] as number;
      }
      const bySource: Record<string, number> = {};
      for (const row of driver
        .prepare(
          'SELECT source, COUNT(*) AS n FROM findings WHERE workspace_id = ? GROUP BY source',
        )
        .all(workspaceId)) {
        bySource[row['source'] as FindingSource] = row['n'] as number;
      }
      const total = bySeverity.error + bySeverity.warning + bySeverity.info;
      return { total, bySeverity, bySource };
    },

    countForWorkspace(workspaceId: string): number {
      const row = driver
        .prepare('SELECT COUNT(*) AS n FROM findings WHERE workspace_id = ?')
        .get(workspaceId);
      return (row?.['n'] as number | undefined) ?? 0;
    },

    clearWorkspace(workspaceId: string): void {
      driver.prepare('DELETE FROM findings WHERE workspace_id = ?').run(workspaceId);
    },
  };
}

export type FindingsRepository = ReturnType<typeof createFindingsRepository>;
