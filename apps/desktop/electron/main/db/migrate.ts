import { createHash } from 'node:crypto';

import type { SqliteDriver } from './driver.js';
import { migrations as defaultMigrations, type Migration } from './migrations.js';

/**
 * Apply every pending migration, in order, each in its own transaction (DB §1). The tracking table
 * records the version, when it applied, and a checksum of the migration's own definition — so a
 * migration that was silently edited after shipping (which forward-only forbids) is detectable
 * rather than a mystery.
 */
export function migrate(driver: SqliteDriver, migrations: readonly Migration[] = defaultMigrations): void {
  driver.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    INTEGER PRIMARY KEY,
      name       TEXT NOT NULL,
      checksum   TEXT NOT NULL,
      applied_at INTEGER NOT NULL
    );
  `);

  const appliedRow = driver.prepare('SELECT MAX(version) AS v FROM schema_migrations').get();
  const currentVersion = typeof appliedRow?.['v'] === 'number' ? appliedRow['v'] : 0;

  const pending = [...migrations]
    .filter((m) => m.version > currentVersion)
    .sort((a, b) => a.version - b.version);

  for (const migration of pending) {
    driver.transaction(() => {
      migration.up(driver);
      driver
        .prepare('INSERT INTO schema_migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)')
        .run(migration.version, migration.name, checksumOf(migration), Date.now());
    });
  }
}

export function currentSchemaVersion(driver: SqliteDriver): number {
  const row = driver.prepare('SELECT MAX(version) AS v FROM schema_migrations').get();
  return typeof row?.['v'] === 'number' ? row['v'] : 0;
}

function checksumOf(migration: Migration): string {
  // The migration's identity is its up() source plus its number and name. Editing any of them
  // after it has shipped is the forbidden thing, and this is what makes it visible.
  return createHash('sha256')
    .update(`${String(migration.version)}:${migration.name}:${migration.up.toString()}`)
    .digest('hex');
}
