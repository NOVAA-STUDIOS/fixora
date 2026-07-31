import { randomUUID } from 'node:crypto';

import type {
  Finding,
  FindingSource,
  FindingsFilter,
  FindingsSummary,
  RepairHistoryAttempt,
  RepairHistoryEntry,
  Severity,
  Verdict,
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
  /** When the user pinned this project, or null if it is not pinned (Sprint F2). */
  pinnedAt: number | null;
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
    pinnedAt: (row['pinned_at'] as number | null) ?? null,
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
        pinnedAt: null,
        settingsJson: '{}',
        createdAt: ts,
      };
    },

    /**
     * Recent workspaces: pinned first (most-recently-pinned first), then everything else by
     * recency — what the "open recent" list reads.
     */
    recent(limit = 10): Workspace[] {
      return driver
        .prepare(
          `SELECT * FROM workspaces
             ORDER BY pinned_at IS NULL, pinned_at DESC, last_opened_at DESC
             LIMIT ?`,
        )
        .all(limit)
        .map(toWorkspace);
    },

    /** Pin or unpin a project. Pinning stamps "now" so pin order is itself recency-ordered. */
    setPinned(id: string, pinned: boolean, ts: number = now()): void {
      driver
        .prepare('UPDATE workspaces SET pinned_at = ? WHERE id = ?')
        .run(pinned ? ts : null, id);
    },

    findByRootPath(rootPath: string): Workspace | undefined {
      const row = driver.prepare('SELECT * FROM workspaces WHERE root_path = ?').get(rootPath);
      return row === undefined ? undefined : toWorkspace(row);
    },

    remove(id: string): void {
      driver.prepare('DELETE FROM workspaces WHERE id = ?').run(id);
    },

    /** Forget every recent. Rows only — a workspace row is a bookmark, never the folder itself. */
    removeAll(): void {
      driver.prepare('DELETE FROM workspaces').run();
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
        .prepare('SELECT data_json FROM findings WHERE workspace_id = ? AND finding_id = ? LIMIT 1')
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

/** What a repair records at proposal time — everything but the row id and timestamps. */
export interface NewRepair {
  workspaceId: string;
  findingId: string;
  relPath: string;
  symbolName: string | null;
  ruleId: string;
  source: string;
  verdict: Verdict;
  rationale: string;
  originalCode: string;
  repairedCode: string;
  model: string | null;
  /** The provider that ultimately answered. Null when the run predates Provider History. */
  provider?: string | null;
  /** Providers tried and failed before the final one — empty when it succeeded on the first try. */
  attempts?: readonly RepairHistoryAttempt[];
  confidence: number;
  startLine: number;
  endLine: number;
}

/** A row from before Provider History (or a corrupt value) reads back as no attempts, never a crash. */
function parseAttempts(value: unknown): RepairHistoryAttempt[] {
  if (typeof value !== 'string' || value === '') return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as RepairHistoryAttempt[]) : [];
  } catch {
    return [];
  }
}

function toHistoryEntry(row: Row): RepairHistoryEntry {
  return {
    id: row['id'] as string,
    findingId: row['finding_id'] as string,
    file: row['rel_path'] as string,
    symbolName: (row['symbol_name'] as string | null) ?? null,
    ruleId: row['rule_id'] as string,
    source: row['source'] as string,
    verdict: row['verdict'] as Verdict,
    applied: (row['applied'] as number) === 1,
    rationale: row['rationale'] as string,
    originalCode: row['original_code'] as string,
    repairedCode: row['repaired_code'] as string,
    model: (row['model'] as string | null) ?? null,
    provider: (row['provider'] as string | null) ?? null,
    attempts: parseAttempts(row['attempts']),
    confidence: row['confidence'] as number,
    startLine: row['start_line'] as number,
    endLine: row['end_line'] as number,
    createdAt: row['created_at'] as number,
    appliedAt: (row['applied_at'] as number | null) ?? null,
  };
}

/**
 * The repair audit trail (Beta Phase E). Every reviewed repair is recorded with its verdict; applying
 * one stamps it applied. This is local and private — the trail the user can inspect to see exactly what
 * the AI proposed and what they accepted.
 */
export function createRepairHistoryRepository(driver: SqliteDriver, now: () => number = Date.now) {
  return {
    record(repair: NewRepair): string {
      const id = randomUUID();
      driver
        .prepare(
          `INSERT INTO repairs
             (id, workspace_id, finding_id, rel_path, symbol_name, rule_id, source, verdict, applied,
              rationale, original_code, repaired_code, model, provider, attempts, confidence,
              start_line, end_line, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          repair.workspaceId,
          repair.findingId,
          repair.relPath,
          repair.symbolName,
          repair.ruleId,
          repair.source,
          repair.verdict,
          repair.rationale,
          repair.originalCode,
          repair.repairedCode,
          repair.model,
          repair.provider ?? null,
          JSON.stringify(repair.attempts ?? []),
          repair.confidence,
          repair.startLine,
          repair.endLine,
          now(),
        );
      return id;
    },

    markApplied(id: string): void {
      driver.prepare('UPDATE repairs SET applied = 1, applied_at = ? WHERE id = ?').run(now(), id);
    },

    list(workspaceId: string, limit = 200): RepairHistoryEntry[] {
      return driver
        .prepare('SELECT * FROM repairs WHERE workspace_id = ? ORDER BY created_at DESC LIMIT ?')
        .all(workspaceId, limit)
        .map(toHistoryEntry);
    },

    remove(id: string): void {
      driver.prepare('DELETE FROM repairs WHERE id = ?').run(id);
    },

    clearWorkspace(workspaceId: string): void {
      driver.prepare('DELETE FROM repairs WHERE workspace_id = ?').run(workspaceId);
    },
  };
}

export type RepairHistoryRepository = ReturnType<typeof createRepairHistoryRepository>;
