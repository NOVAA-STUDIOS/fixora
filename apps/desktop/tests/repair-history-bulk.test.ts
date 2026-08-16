import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { SqliteDriver } from '../electron/main/db/driver.js';
import { migrate } from '../electron/main/db/migrate.js';
import { createNodeSqliteDriver } from '../electron/main/db/node-sqlite-driver.js';
import { createRepairHistoryRepository, type NewRepair } from '../electron/main/db/repositories.js';

/**
 * `createRepairHistoryRepository`'s buffer/replay logic — the actual mechanism behind "Repair All":
 * `beginBulk()` defers `record()`/`markApplied()` writes, `flush()` replays them all inside one
 * `driver.transaction()`. Against a REAL `:memory:` driver, migrated with the real schema, so a
 * mistake in the SQL (a column, an FK) fails here, not silently in production.
 */

const repair = (overrides: Partial<NewRepair> = {}): NewRepair => ({
  workspaceId: 'ws1',
  findingId: 'f1',
  relPath: 'src/a.ts',
  symbolName: null,
  ruleId: 'no-unused-vars',
  source: 'eslint',
  verdict: 'verified',
  rationale: 'unused variable removed',
  originalCode: 'const a = 1;',
  repairedCode: '',
  model: 'test-model',
  confidence: 1,
  startLine: 1,
  endLine: 1,
  ...overrides,
});

let driver: SqliteDriver;
beforeEach(() => {
  driver = createNodeSqliteDriver(':memory:');
  migrate(driver);
  driver
    .prepare(
      'INSERT INTO workspaces (id, root_path, name, last_opened_at, created_at) VALUES (?, ?, ?, ?, ?)',
    )
    .run('ws1', '/tmp/ws1', 'ws1', Date.now(), Date.now());
});
afterEach(() => {
  driver.close();
});

describe('repair history — bulk buffering', () => {
  it('without beginBulk(), record()/markApplied() write immediately (unchanged default path)', () => {
    const repo = createRepairHistoryRepository(driver);
    const id = repo.record(repair());
    expect(repo.list('ws1')).toHaveLength(1);
    repo.markApplied(id);
    expect(repo.list('ws1')[0]?.applied).toBe(true);
  });

  it('after beginBulk(), record() returns an id but writes nothing until flush()', () => {
    const repo = createRepairHistoryRepository(driver);
    repo.beginBulk();
    const id = repo.record(repair());
    expect(id).toMatch(/.+/);
    expect(repo.list('ws1')).toHaveLength(0);

    const flushed = repo.flush();
    expect(flushed).toBe(1);
    expect(repo.list('ws1')).toHaveLength(1);
  });

  it('markApplied() during a buffered run is also deferred, and lands correctly on flush', () => {
    const repo = createRepairHistoryRepository(driver);
    repo.beginBulk();
    const id = repo.record(repair());
    repo.markApplied(id);
    expect(repo.list('ws1')).toHaveLength(0); // nothing written yet

    repo.flush();
    const [entry] = repo.list('ws1');
    expect(entry?.applied).toBe(true);
  });

  it('flush() with nothing buffered returns 0 and touches nothing', () => {
    const repo = createRepairHistoryRepository(driver);
    repo.beginBulk();
    expect(repo.flush()).toBe(0);
    expect(repo.list('ws1')).toHaveLength(0);
  });

  it('flush() commits several buffered repairs together, in one transaction', () => {
    const repo = createRepairHistoryRepository(driver);
    repo.beginBulk();
    repo.record(repair({ findingId: 'f1' }));
    repo.record(repair({ findingId: 'f2' }));
    repo.record(repair({ findingId: 'f3' }));
    expect(repo.flush()).toBe(3);
    expect(repo.list('ws1')).toHaveLength(3);
  });

  it('a second beginBulk() without flushing resets the buffer rather than leaking it', () => {
    const repo = createRepairHistoryRepository(driver);
    repo.beginBulk();
    repo.record(repair());
    repo.beginBulk(); // no flush in between
    expect(repo.flush()).toBe(0);
    expect(repo.list('ws1')).toHaveLength(0);
  });
});
