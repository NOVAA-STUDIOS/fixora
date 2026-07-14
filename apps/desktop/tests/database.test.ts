import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { openDatabase } from '../electron/main/db/database.js';
import { currentSchemaVersion, migrate } from '../electron/main/db/migrate.js';
import { migrations } from '../electron/main/db/migrations.js';
import { createNodeSqliteDriver } from '../electron/main/db/node-sqlite-driver.js';
import {
  createFileIndexRepository,
  createWorkspaceRepository,
} from '../electron/main/db/repositories.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'fixora-db-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/**
 * The M2 acceptance criterion for persistence: "DB migration from an empty DB and from v1→v2 both
 * succeed." Plus the non-negotiable DB §1 rule: a corrupt database degrades to "history
 * unavailable", never blocks launch.
 */
describe('migrations', () => {
  it('migrates an empty database to the current version', () => {
    const { driver, recovered } = openDatabase({ dir });
    expect(recovered).toBe(false);
    expect(currentSchemaVersion(driver)).toBe(migrations.length);
    // Both tables exist and are queryable.
    expect(driver.prepare('SELECT COUNT(*) AS n FROM workspaces').get()).toEqual({ n: 0 });
    expect(driver.prepare('SELECT COUNT(*) AS n FROM files_index').get()).toEqual({ n: 0 });
    driver.close();
  });

  it('migrates v1 → v2 without losing v1 data', () => {
    const dbPath = join(dir, 'fixora.db');
    // Bring a database to v1 only, and put a row in it.
    const d1 = createNodeSqliteDriver(dbPath);
    migrate(
      d1,
      migrations.filter((m) => m.version === 1),
    );
    expect(currentSchemaVersion(d1)).toBe(1);
    d1.prepare(
      `INSERT INTO workspaces (id, root_path, name, last_opened_at, created_at)
       VALUES ('w1', '/repo', 'repo', 1, 1)`,
    ).run();
    d1.close();

    // Re-open through the full pipeline: it applies v2 and the v1 row survives.
    const { driver, recovered } = openDatabase({ dir });
    expect(recovered).toBe(false);
    expect(currentSchemaVersion(driver)).toBe(2);
    expect(driver.prepare('SELECT name FROM workspaces WHERE id = ?').get('w1')).toEqual({
      name: 'repo',
    });
    // The v2 table now exists.
    expect(() => driver.prepare('SELECT * FROM files_index').all()).not.toThrow();
    driver.close();
  });

  it('is idempotent — re-opening an up-to-date DB applies nothing', () => {
    const first = openDatabase({ dir });
    first.driver.close();
    const second = openDatabase({ dir });
    expect(currentSchemaVersion(second.driver)).toBe(migrations.length);
    second.driver.close();
  });

  it('backs up the database before migrating an existing one', () => {
    openDatabase({ dir }).driver.close();
    openDatabase({ dir }).driver.close(); // second open sees an existing file → writes .bak
    expect(existsSync(join(dir, 'fixora.db.bak'))).toBe(true);
  });
});

describe('corruption degrades to a fresh DB, never a crash (DB §1)', () => {
  it('quarantines a corrupt file and starts empty instead of throwing', () => {
    const dbPath = join(dir, 'fixora.db');
    // A file that is not a valid SQLite database.
    writeFileSync(dbPath, 'this is not a database, it is garbage');

    const { driver, recovered } = openDatabase({ dir });
    expect(recovered).toBe(true);
    // The app is usable: schema is present, queries work.
    expect(currentSchemaVersion(driver)).toBe(migrations.length);
    // The corrupt file was moved aside, not deleted.
    expect(existsSync(dbPath)).toBe(true);
    driver.close();
  });
});

describe('repositories', () => {
  it('upserts a workspace and lists it as recent', () => {
    const { driver } = openDatabase({ dir });
    let clock = 100;
    const repo = createWorkspaceRepository(driver, () => clock);

    const created = repo.upsertByRootPath('/repo-a', 'repo-a');
    expect(created.rootPath).toBe('/repo-a');

    clock = 200;
    repo.upsertByRootPath('/repo-b', 'repo-b');
    clock = 300;
    repo.upsertByRootPath('/repo-a', 'repo-a'); // re-open A, bumps its recency

    expect(repo.recent().map((w) => w.rootPath)).toEqual(['/repo-a', '/repo-b']);
    // Re-open did not create a duplicate.
    expect(repo.recent()).toHaveLength(2);
    driver.close();
  });

  it('replaces a workspace file index transactionally', () => {
    const { driver } = openDatabase({ dir });
    const workspaces = createWorkspaceRepository(driver);
    const files = createFileIndexRepository(driver);
    const ws = workspaces.upsertByRootPath('/repo', 'repo');

    files.replaceAll(ws.id, [
      { relPath: 'a.ts', language: 'typescript', sizeBytes: 10, mtime: 1, contentHash: 'h1' },
      { relPath: 'b.py', language: 'python', sizeBytes: 20, mtime: 2, contentHash: 'h2' },
    ]);
    expect(files.countForWorkspace(ws.id)).toBe(2);

    // A second replaceAll overwrites, it does not append.
    files.replaceAll(ws.id, [
      { relPath: 'c.go', language: 'go', sizeBytes: 30, mtime: 3, contentHash: 'h3' },
    ]);
    expect(files.countForWorkspace(ws.id)).toBe(1);
    driver.close();
  });

  it('cascades file rows when a workspace is removed', () => {
    const { driver } = openDatabase({ dir });
    const workspaces = createWorkspaceRepository(driver);
    const files = createFileIndexRepository(driver);
    const ws = workspaces.upsertByRootPath('/repo', 'repo');
    files.replaceAll(ws.id, [
      { relPath: 'a.ts', language: 'typescript', sizeBytes: 10, mtime: 1, contentHash: 'h1' },
    ]);

    workspaces.remove(ws.id);
    expect(files.countForWorkspace(ws.id)).toBe(0);
    driver.close();
  });
});
