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
  {
    version: 3,
    name: 'findings',
    up: (d) => {
      // The analysis engine's output (M3). `finding_id` is the stable-across-runs id (core-analysis
      // `findingId`) — unique per workspace — so re-analyzing a file replaces its rows by
      // (workspace_id, rel_path) while a finding keeps its identity for the verification comparison
      // (M6). The full Finding (evidence, raw tool output) is kept as JSON; the columns exist for the
      // panel's grouping/filtering by severity, source and file without parsing every row.
      d.exec(`
        CREATE TABLE findings (
          id           TEXT PRIMARY KEY,
          workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
          finding_id   TEXT NOT NULL,
          rel_path     TEXT NOT NULL,
          source       TEXT NOT NULL,
          rule_id      TEXT NOT NULL,
          severity     TEXT NOT NULL,
          category     TEXT NOT NULL,
          start_line   INTEGER NOT NULL,
          start_col    INTEGER NOT NULL,
          end_line     INTEGER NOT NULL,
          end_col      INTEGER NOT NULL,
          message      TEXT NOT NULL,
          fixable      INTEGER NOT NULL,
          confidence   REAL NOT NULL,
          data_json    TEXT NOT NULL,
          created_at   INTEGER NOT NULL,
          UNIQUE(workspace_id, finding_id)
        );
        CREATE INDEX idx_findings_workspace ON findings(workspace_id, severity);
        CREATE INDEX idx_findings_file ON findings(workspace_id, rel_path);
        CREATE INDEX idx_findings_source ON findings(workspace_id, source);
      `);
    },
  },
  {
    version: 4,
    name: 'repairs',
    up: (d) => {
      // The auditable repair history (M5, Beta Phase E). Every AI repair the user reviews is recorded
      // here with its verification verdict and whether it was applied — the local, private audit trail
      // that makes "trust us with your code" a thing the user can inspect, not just a claim. Local
      // SQLite may hold code (DB §1: local holds everything about the user's code), so the original and
      // repaired text live here so a past fix can be reviewed or re-copied long after the run.
      d.exec(`
        CREATE TABLE repairs (
          id            TEXT PRIMARY KEY,
          workspace_id  TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
          finding_id    TEXT NOT NULL,
          rel_path      TEXT NOT NULL,
          symbol_name   TEXT,
          rule_id       TEXT NOT NULL,
          source        TEXT NOT NULL,
          verdict       TEXT NOT NULL,
          applied       INTEGER NOT NULL DEFAULT 0,
          rationale     TEXT NOT NULL,
          original_code TEXT NOT NULL,
          repaired_code TEXT NOT NULL,
          model         TEXT,
          confidence    REAL NOT NULL,
          start_line    INTEGER NOT NULL,
          end_line      INTEGER NOT NULL,
          created_at    INTEGER NOT NULL,
          applied_at    INTEGER
        );
        CREATE INDEX idx_repairs_workspace ON repairs(workspace_id, created_at DESC);
      `);
    },
  },
  {
    version: 5,
    name: 'suggestions',
    up: (d) => {
      // Sprint F1 (Suggestion System). Unlike workspaces/findings/repairs, a suggestion is not
      // scoped to a project — it is feedback about Fixora itself — so there is no workspace_id and
      // no FK. Kept intentionally small: an id, a category, the message, and when it was submitted.
      d.exec(`
        CREATE TABLE suggestions (
          id         TEXT PRIMARY KEY,
          category   TEXT NOT NULL,
          message    TEXT NOT NULL,
          created_at INTEGER NOT NULL
        );
        CREATE INDEX idx_suggestions_created_at ON suggestions(created_at DESC);
      `);
    },
  },
  {
    version: 6,
    name: 'workspaces_pinned',
    up: (d) => {
      // Sprint F2 (Welcome Experience): pin support for recent projects. A single nullable
      // timestamp carries both facts a pin needs — whether it is pinned (non-null) and the order
      // among pinned entries (most-recently-pinned first) — rather than a separate boolean plus a
      // second ordering column.
      d.exec(`ALTER TABLE workspaces ADD COLUMN pinned_at INTEGER`);
    },
  },
  {
    version: 7,
    name: 'repairs_provider_history',
    up: (d) => {
      // Provider History (Public Beta stabilization). Nullable/defaulted so every existing row reads
      // back unchanged — an old repair simply has no provider recorded and an empty attempt list,
      // which is the honest answer for a repair from before providers other than OpenRouter existed.
      d.exec(`ALTER TABLE repairs ADD COLUMN provider TEXT`);
      // JSON array of {provider, model, category} — the walk that led to this repair's final
      // provider, for the same reason `AiFailure.attempts` exists on the failure card: without it,
      // a user has no way to see that Fixora already tried other providers on their behalf.
      d.exec(`ALTER TABLE repairs ADD COLUMN attempts TEXT NOT NULL DEFAULT '[]'`);
    },
  },
  {
    version: 8,
    name: 'repairs_verify_attempts',
    up: (d) => {
      // Distinct from `attempts` (v7, above): that column is which PROVIDERS were tried before one
      // answered. This one is what happened on EACH pass through ai-service.ts's own verify/re-ask
      // loop (VERIFY_RETRY_LIMIT) once a provider HAD answered — same provider and model on every
      // entry, a different verdict each time. Conflating the two would make "how many providers
      // failed over" and "how many verify retries fired" the same number, which they are not.
      d.exec(`ALTER TABLE repairs ADD COLUMN verify_attempts TEXT NOT NULL DEFAULT '[]'`);
    },
  },
  {
    version: 9,
    name: 'repairs_was_forced',
    up: (d) => {
      // Whether VERIFICATION was overridden (ai.handlers.ts's `forced`) at apply time. Previously
      // logged only to the console — the audit trail is the one place this belongs, since it is
      // exactly the record "trust us with your code" promises the user can inspect.
      d.exec(`ALTER TABLE repairs ADD COLUMN was_forced INTEGER NOT NULL DEFAULT 0`);
    },
  },
  {
    version: 10,
    name: 'repair_limit',
    up: (d) => {
      // Single-row table (id is pinned to 1) — replaces the plain `repair-count.json` file, which
      // had no protection against a concurrent writer (a `--mcp` standalone process sharing the
      // same userData dir). SQLite's own locking makes that race the driver's problem, not ours.
      d.exec(`
        CREATE TABLE IF NOT EXISTS repair_limit (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          window_start INTEGER NOT NULL,
          repairs_today INTEGER NOT NULL DEFAULT 0,
          plan TEXT NOT NULL DEFAULT 'free',
          license_key TEXT,
          last_validated_at INTEGER
        )
      `);
    },
  },
  {
    version: 11,
    name: 'referrals',
    up: (d) => {
      // Single row per install, same as repair_limit — this device has exactly one code of its own
      // and can redeem exactly one other code, ever.
      d.exec(`
        CREATE TABLE IF NOT EXISTS referrals (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          my_code TEXT NOT NULL UNIQUE,
          used_code TEXT,
          bonus_repairs INTEGER NOT NULL DEFAULT 0,
          redeemed_at INTEGER,
          created_at INTEGER NOT NULL DEFAULT (unixepoch())
        )
      `);
    },
  },
  {
    version: 12,
    name: 'referrals_count',
    up: (d) => {
      // How many times THIS device's own code has been redeemed — by someone else, on their own
      // device. There is no server, so nothing here can ever increment it: no channel exists for
      // another install to report a redemption back. Column exists so a future server-backed
      // version has somewhere to write; until then it reads 0, honestly (see referral.handlers.ts).
      d.exec(`ALTER TABLE referrals ADD COLUMN times_used INTEGER NOT NULL DEFAULT 0`);
    },
  },
];
