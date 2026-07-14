import { copyFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';

import type { SqliteDriver } from './driver.js';
import { migrate } from './migrate.js';
import { createNodeSqliteDriver } from './node-sqlite-driver.js';

export type DatabaseOpenResult = {
  driver: SqliteDriver;
  /**
   * True when a corrupt database was found and replaced with an empty one. The UI shows "history
   * unavailable" (DB §1) — the user's code is on disk; their history is a convenience, and losing
   * the convenience must never cost them the tool.
   */
  recovered: boolean;
};

export type DatabaseDeps = {
  /** Directory for the DB file (app.getPath('userData') in production; a temp dir in tests). */
  dir: string;
  /** Injectable so tests can substitute an in-memory or throwing driver. */
  createDriver?: (filename: string) => SqliteDriver;
  now?: () => number;
};

/**
 * Open the local database, bringing it to the current schema — and **never blocking launch on it**
 * (DB §1). The order matters:
 *
 *   1. If a DB file exists, integrity-check it. If it is corrupt, move it aside and start fresh —
 *      degrade to "history unavailable", do not crash.
 *   2. Back up the (healthy) file before migrating, so a failed migration is recoverable.
 *   3. Migrate. A migration failure throws, but the pre-migration backup is on disk.
 *
 * The one hard rule: a corrupted local DB degrades to "history unavailable", never to "the app
 * won't launch". Their code is on disk; their history is a convenience.
 */
export function openDatabase(deps: DatabaseDeps): DatabaseOpenResult {
  const { dir, createDriver = createNodeSqliteDriver } = deps;
  mkdirSync(dir, { recursive: true });

  const dbPath = join(dir, 'fixora.db');
  const hadExisting = existsSync(dbPath);

  let recovered = false;

  // A corrupt database announces itself two ways: the driver throws while opening it (a garbage
  // file), or it opens but fails `integrity_check`. Both mean "history unavailable", not "crash".
  let driver = tryOpenHealthy(createDriver, dbPath, hadExisting);
  if (driver === null) {
    quarantine(dbPath);
    driver = createDriver(dbPath);
    recovered = true;
  }

  // Back up the healthy file before touching its schema. A no-op on a brand-new empty DB.
  if (hadExisting && !recovered) {
    try {
      copyFileSync(dbPath, `${dbPath}.bak`);
    } catch {
      // A failed backup is not a reason to refuse to launch; migrations are still transactional.
    }
  }

  migrate(driver);
  return { driver, recovered };
}

/**
 * Open the database and return it only if it is healthy. Returns null for a corrupt DB — whether
 * it threw on open (garbage file) or failed the integrity check — having released the handle so
 * the file can be moved aside. A brand-new (non-existing) DB is always considered healthy.
 */
function tryOpenHealthy(
  createDriver: (filename: string) => SqliteDriver,
  dbPath: string,
  hadExisting: boolean,
): SqliteDriver | null {
  let driver: SqliteDriver;
  try {
    driver = createDriver(dbPath);
  } catch {
    return null; // opening a garbage file threw during setup
  }
  if (hadExisting && !driver.isHealthy()) {
    driver.close();
    return null;
  }
  return driver;
}

/** Move a corrupt database (and its WAL sidecars) aside for possible manual rescue. Best-effort. */
function quarantine(dbPath: string): void {
  const dest = `${dbPath}.corrupt-${String(Date.now())}`;
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      if (existsSync(dbPath + suffix)) renameSync(dbPath + suffix, dest + suffix);
    } catch {
      // If we cannot move it, the fresh driver will overwrite it — we still must launch.
    }
  }
}
