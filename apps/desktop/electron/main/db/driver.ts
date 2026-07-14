/**
 * The database driver seam (ADR-033). Repositories and migrations depend on this interface, never
 * on `node:sqlite` directly, so the driver choice stays contained — swapping back to
 * better-sqlite3, or to a WASM build for a future web target, is a one-file change and the
 * repository tests do not move.
 *
 * It is the minimal synchronous surface the repositories actually use. Synchronous is a feature
 * here: the DB lives in the main process, not the UI thread, so there is no event loop to block
 * and no callback interleaving to get a migration wrong (ADR-011's original reasoning, unchanged).
 */

export type SqlValue = string | number | bigint | null | Uint8Array;
export type Row = Record<string, SqlValue>;

export interface SqliteStatement {
  run(...params: SqlValue[]): { changes: number | bigint };
  get(...params: SqlValue[]): Row | undefined;
  all(...params: SqlValue[]): Row[];
}

export interface SqliteDriver {
  /** Execute one or more statements with no parameters (DDL, PRAGMA). */
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
  /** Run `fn` inside a transaction; roll back if it throws. Returns `fn`'s result. */
  transaction<T>(fn: () => T): T;
  /** PRAGMA integrity_check — 'ok' iff the database is not corrupt. */
  isHealthy(): boolean;
  close(): void;
}
