import type { SqliteDriver } from './driver.js';

/**
 * A forward-only, numbered migration (DB §1). Migrations never edit an older migration — history
 * is append-only — and each runs inside a transaction with a file backup already taken, so a
 * failure leaves the database on its previous version rather than half-migrated.
 */
export type Migration = {
  version: number;
  name: string;
  up: (driver: SqliteDriver) => void;
};

/**
 * The migration list. M2 splits the initial schema across two migrations on purpose: it gives us a
 * real v1→v2 step to exercise (the acceptance criterion is "migration from an empty DB and from
 * v1→v2 both succeed"), and it is how the schema will actually grow — additively, one numbered
 * step at a time.
 *
 * These three tables are the M2 subset of the local schema (DB §1); findings/patches/verifications
 * arrive with the milestones that produce them.
 */
export const migrations: readonly Migration[] = [
  {
    version: 1,
    name: 'workspaces_and_sessions',
    up: (d) => {
      d.exec(`
        CREATE TABLE workspaces (
          id            TEXT PRIMARY KEY,
          root_path     TEXT NOT NULL UNIQUE,
          name          TEXT NOT NULL,
          last_opened_at INTEGER NOT NULL,
          settings_json TEXT NOT NULL DEFAULT '{}',
          created_at    INTEGER NOT NULL
        );

        CREATE TABLE sessions (
          id           TEXT PRIMARY KEY,
          workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
          task_profile TEXT,
          trigger      TEXT,
          model        TEXT,
          status       TEXT NOT NULL,
          started_at   INTEGER NOT NULL,
          ended_at     INTEGER
        );
        CREATE INDEX idx_sessions_workspace ON sessions(workspace_id, started_at DESC);
      `);
    },
  },
  {
    version: 2,
    name: 'files_index',
    up: (d) => {
      // content_hash is the cache key for analysis (M3) and the conflict-detection key for patches
      // (M6) — it earns its keep twice (DB §1), which is why it exists before either is built.
      d.exec(`
        CREATE TABLE files_index (
          id           TEXT PRIMARY KEY,
          workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
          rel_path     TEXT NOT NULL,
          language     TEXT,
          size_bytes   INTEGER NOT NULL,
          mtime        INTEGER NOT NULL,
          content_hash TEXT,
          indexed_at   INTEGER NOT NULL,
          UNIQUE(workspace_id, rel_path)
        );
        CREATE INDEX idx_files_language ON files_index(workspace_id, language);
      `);
    },
  },
];
