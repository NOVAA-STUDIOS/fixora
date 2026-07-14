import { DatabaseSync } from 'node:sqlite';

import type { SqliteDriver, SqliteStatement, SqlValue } from './driver.js';

/**
 * The `node:sqlite` implementation of `SqliteDriver` (ADR-033). The only file in the app that
 * imports `node:sqlite`; everything else speaks the interface. WAL mode and the busy timeout are
 * set here because they are properties of *this* driver's connection, not of the schema.
 */
export function createNodeSqliteDriver(filename: string): SqliteDriver {
  const db = new DatabaseSync(filename);

  // Opening a *garbage* file as a database succeeds, but the first PRAGMA that touches its pages
  // throws "file is not a database". If setup fails we must release the handle before rethrowing,
  // or the caller cannot move the corrupt file aside (it stays locked). That is what turns a
  // corruption into an unrecoverable EPERM instead of a clean quarantine.
  try {
    // WAL: concurrent reads while the single writer (this process) writes, and a crash-safe
    // journal (ADR-011). foreign_keys on so our references are enforced. A busy timeout so a
    // transient lock (e.g. the OS flushing WAL) waits rather than throwing.
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA foreign_keys = ON');
    db.exec('PRAGMA busy_timeout = 5000');
  } catch (error) {
    db.close();
    throw error;
  }

  const wrapStatement = (sql: string): SqliteStatement => {
    const stmt = db.prepare(sql);
    return {
      run: (...params: SqlValue[]) => {
        const info = stmt.run(...params);
        return { changes: info.changes };
      },
      get: (...params: SqlValue[]) => stmt.get(...params),
      all: (...params: SqlValue[]) => stmt.all(...params),
    };
  };

  return {
    exec: (sql) => {
      db.exec(sql);
    },
    prepare: wrapStatement,
    transaction: <T,>(fn: () => T): T => {
      db.exec('BEGIN');
      try {
        const result = fn();
        db.exec('COMMIT');
        return result;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
    isHealthy: () => {
      try {
        const row = db.prepare('PRAGMA integrity_check').get() as { integrity_check?: string };
        return row.integrity_check === 'ok';
      } catch {
        return false;
      }
    },
    close: () => {
      db.close();
    },
  };
}
