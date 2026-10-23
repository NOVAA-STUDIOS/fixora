import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Finding } from '@fixora/shared-types';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DatabaseMigrationStartupError, openDatabase } from '../electron/main/db/database.js';
import type { SqliteDriver } from '../electron/main/db/driver.js';
import {
  DatabaseMigrationIntegrityError,
  currentSchemaVersion,
  migrate,
} from '../electron/main/db/migrate.js';
import { migrations, type Migration } from '../electron/main/db/migrations.js';
import { createNodeSqliteDriver } from '../electron/main/db/node-sqlite-driver.js';
import {
  createFileIndexRepository,
  createFindingsRepository,
  createRepairHistoryRepository,
  createZapprConversationRepository,
  createWorkspaceRepository,
  type NewRepair,
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

    // Re-open through the full pipeline: it applies every later migration and the v1 row survives.
    const { driver, recovered } = openDatabase({ dir });
    expect(recovered).toBe(false);
    expect(currentSchemaVersion(driver)).toBe(migrations.length);
    expect(driver.prepare('SELECT name FROM workspaces WHERE id = ?').get('w1')).toEqual({
      name: 'repo',
    });
    // The later tables now exist (v2 files_index, v3 findings).
    expect(() => driver.prepare('SELECT * FROM files_index').all()).not.toThrow();
    expect(() => driver.prepare('SELECT * FROM findings').all()).not.toThrow();
    driver.close();
  });

  it('is idempotent — re-opening an up-to-date DB applies nothing', () => {
    const first = openDatabase({ dir });
    first.driver.close();
    const second = openDatabase({ dir });
    expect(currentSchemaVersion(second.driver)).toBe(migrations.length);
    second.driver.close();
  });

  it('accepts matching checksums for applied migrations', () => {
    const driver = createNodeSqliteDriver(join(dir, 'checksum.db'));
    const first: Migration = {
      version: 1,
      name: 'checksum_first',
      up: (db) => {
        db.exec('CREATE TABLE checksum_first (id INTEGER PRIMARY KEY)');
      },
    };
    migrate(driver, [first]);

    expect(() => {
      migrate(driver, [first]);
    }).not.toThrow();
    expect(currentSchemaVersion(driver)).toBe(1);
    driver.close();
  });

  it('rejects checksum drift without overwriting it or applying newer migrations', () => {
    const driver = createNodeSqliteDriver(join(dir, 'drift.db'));
    const first: Migration = {
      version: 1,
      name: 'drift_first',
      up: (db) => {
        db.exec('CREATE TABLE drift_first (id INTEGER PRIMARY KEY)');
      },
    };
    const second: Migration = {
      version: 2,
      name: 'drift_second',
      up: (db) => {
        db.exec('CREATE TABLE drift_second (id INTEGER PRIMARY KEY)');
      },
    };
    migrate(driver, [first]);
    driver.prepare('UPDATE schema_migrations SET checksum = ? WHERE version = 1').run('changed');

    expect(() => {
      migrate(driver, [first, second]);
    }).toThrow(DatabaseMigrationIntegrityError);
    expect(
      driver.prepare('SELECT checksum FROM schema_migrations WHERE version = 1').get(),
    ).toEqual({
      checksum: 'changed',
    });
    expect(() => driver.prepare('SELECT * FROM drift_second').all()).toThrow();
    expect(currentSchemaVersion(driver)).toBe(1);
    driver.close();
  });

  it('backs up the database before migrating an existing one', () => {
    openDatabase({ dir }).driver.close();
    openDatabase({ dir }).driver.close(); // second open sees an existing file → writes .bak
    expect(existsSync(join(dir, 'fixora.db.bak'))).toBe(true);
  });

  it('preserves a healthy drifted database and backup, with a stable path-free error', () => {
    const { driver } = openDatabase({ dir });
    driver.prepare('UPDATE schema_migrations SET checksum = ? WHERE version = 1').run('changed');
    driver.close();

    expect(() => openDatabase({ dir })).toThrow('Database migration integrity check failed');
    expect(existsSync(join(dir, 'fixora.db.bak'))).toBe(true);
    const preserved = createNodeSqliteDriver(join(dir, 'fixora.db'));
    expect(
      preserved.prepare('SELECT checksum FROM schema_migrations WHERE version = 1').get(),
    ).toEqual({
      checksum: 'changed',
    });
    preserved.close();
  });

  it('closes and preserves a healthy database when a migration cannot apply', () => {
    const dbPath = join(dir, 'fixora.db');
    const seeded = createNodeSqliteDriver(dbPath);
    seeded.exec('CREATE TABLE workspaces (id TEXT PRIMARY KEY)');
    seeded.prepare('INSERT INTO workspaces (id) VALUES (?)').run('existing-data');
    seeded.close();

    expect(() => openDatabase({ dir })).toThrow(DatabaseMigrationStartupError);
    expect(existsSync(`${dbPath}.bak`)).toBe(true);
    const preserved = createNodeSqliteDriver(dbPath);
    expect(preserved.prepare('SELECT id FROM workspaces').get()).toEqual({ id: 'existing-data' });
    preserved.close();
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

  it('records repair history, marks it applied, and lists newest first', () => {
    const { driver } = openDatabase({ dir });
    const workspaces = createWorkspaceRepository(driver);
    const ws = workspaces.upsertByRootPath('/repo', 'repo');
    let clock = 1000;
    const history = createRepairHistoryRepository(driver, () => clock);

    const base: Omit<NewRepair, 'ruleId' | 'verdict'> = {
      workspaceId: ws.id,
      findingId: 'f1',
      relPath: 'src/a.ts',
      symbolName: 'greet',
      source: 'eslint',
      rationale: 'use a template literal',
      originalCode: 'a + b',
      repairedCode: '`${a}${b}`',
      model: 'anthropic/claude-3.5-sonnet',
      confidence: 0.9,
      startLine: 1,
      endLine: 3,
    };

    const firstId = history.record({ ...base, ruleId: 'prefer-template', verdict: 'verified' });
    clock = 2000;
    history.record({ ...base, findingId: 'f2', ruleId: 'no-unused', verdict: 'regression' });

    const entries = history.list(ws.id);
    expect(entries).toHaveLength(2);
    expect(entries[0]?.ruleId).toBe('no-unused'); // newest first
    expect(entries[1]?.applied).toBe(false);

    clock = 3000;
    history.markApplied(firstId);
    const applied = history.list(ws.id).find((e) => e.id === firstId);
    expect(applied?.applied).toBe(true);
    expect(applied?.appliedAt).toBe(3000);
    expect(applied?.repairedCode).toBe('`${a}${b}`'); // the code is preserved for later review

    // Cascade + scoping: another workspace's history is separate.
    expect(history.list('other-ws')).toEqual([]);
    driver.close();
  });

  /**
   * Provider History: which provider actually answered, and what was tried before it, round-trips
   * through real SQLite — not just through the schema. A repair recorded without provider info
   * (the deterministic micro-repair path, or a pre-migration row) must read back as `null`/`[]`
   * rather than crashing or fabricating a value.
   */
  it('records and reads back the provider and the attempt history', () => {
    const { driver } = openDatabase({ dir });
    const workspaces = createWorkspaceRepository(driver);
    const ws = workspaces.upsertByRootPath('/repo', 'repo');
    const history = createRepairHistoryRepository(driver);

    const base: Omit<NewRepair, 'ruleId' | 'verdict'> = {
      workspaceId: ws.id,
      findingId: 'f1',
      relPath: 'src/a.ts',
      symbolName: 'greet',
      source: 'eslint',
      rationale: 'use a template literal',
      originalCode: 'a + b',
      repairedCode: '`${a}${b}`',
      model: 'gpt-4.1-mini',
      confidence: 0.9,
      startLine: 1,
      endLine: 3,
    };

    const withRetriesId = history.record({
      ...base,
      ruleId: 'prefer-template',
      verdict: 'verified',
      provider: 'openai',
      attempts: [
        { provider: 'openrouter', model: 'openai/gpt-oss-20b:free', category: 'quota-exceeded' },
      ],
    });
    const noProviderId = history.record({
      ...base,
      findingId: 'f2',
      ruleId: 'no-unused',
      verdict: 'verified',
      model: null,
      // provider/attempts omitted entirely — the deterministic (safe-auto) path shape.
    });

    const entries = history.list(ws.id);
    const withRetries = entries.find((e) => e.id === withRetriesId);
    const noProvider = entries.find((e) => e.id === noProviderId);

    expect(withRetries?.provider).toBe('openai');
    expect(withRetries?.attempts).toEqual([
      { provider: 'openrouter', model: 'openai/gpt-oss-20b:free', category: 'quota-exceeded' },
    ]);
    // The honest default for a repair that used no AI provider at all — never a fabricated "openrouter".
    expect(noProvider?.provider).toBeNull();
    expect(noProvider?.attempts).toEqual([]);
    driver.close();
  });

  it('an existing v6 row (before Provider History) reads back as unattributed, not corrupted', () => {
    const { driver } = openDatabase({ dir });
    const workspaces = createWorkspaceRepository(driver);
    const ws = workspaces.upsertByRootPath('/repo', 'repo');
    // Simulate a row from before migration 7 by inserting directly, bypassing the repository's own
    // (now provider-aware) INSERT — this is what an upgraded user's existing data actually looks like.
    driver
      .prepare(
        `INSERT INTO repairs
           (id, workspace_id, finding_id, rel_path, symbol_name, rule_id, source, verdict, applied,
            rationale, original_code, repaired_code, model, confidence, start_line, end_line, created_at)
         VALUES ('legacy-1', ?, 'f1', 'src/a.ts', 'a', 'prefer-const', 'eslint', 'verified', 0,
                 'r', 'old', 'new', 'gpt-4', 0.9, 1, 1, 1000)`,
      )
      .run(ws.id);

    const history = createRepairHistoryRepository(driver);
    const entry = history.list(ws.id).find((e) => e.id === 'legacy-1');
    expect(entry).toBeDefined();
    expect(entry?.provider).toBeNull();
    expect(entry?.attempts).toEqual([]); // the column default ('[]'), parsed cleanly
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

  it('replaces findings per file and summarises by severity/source', () => {
    const { driver } = openDatabase({ dir });
    const workspaces = createWorkspaceRepository(driver);
    const findings = createFindingsRepository(driver);
    const ws = workspaces.upsertByRootPath('/repo', 'repo');

    const make = (
      id: string,
      sev: Finding['severity'],
      src: Finding['source'],
      file: string,
    ): Finding => ({
      id,
      source: src,
      ruleId: 'r',
      severity: sev,
      category: 'correctness',
      location: { file, startLine: 1, startCol: 1, endLine: 1, endCol: 2 },
      message: 'm',
      evidence: { snippet: 's', relatedLocations: [], toolOutput: null },
      fixable: false,
      repair: 'ai-required',
      confidence: 1,
    });

    findings.replaceForFile(ws.id, 'a.ts', [
      make('1', 'error', 'eslint', 'a.ts'),
      make('2', 'warning', 'complexity', 'a.ts'),
    ]);
    findings.replaceForFile(ws.id, 'b.py', [make('3', 'error', 'ruff', 'b.py')]);
    expect(findings.countForWorkspace(ws.id)).toBe(3);

    const summary = findings.summary(ws.id);
    expect(summary.total).toBe(3);
    expect(summary.bySeverity.error).toBe(2);
    expect(summary.bySeverity.warning).toBe(1);
    expect(summary.bySource['eslint']).toBe(1);

    // Re-analyzing a.ts replaces only its findings, not b.py's.
    findings.replaceForFile(ws.id, 'a.ts', [make('1', 'error', 'eslint', 'a.ts')]);
    expect(findings.countForWorkspace(ws.id)).toBe(2);

    // Filter + severity ordering: errors first.
    const errors = findings.list(ws.id, { severity: 'error' });
    expect(errors.map((f) => f.id).sort()).toEqual(['1', '3']);
    driver.close();
  });

  it('cascades findings when a workspace is removed', () => {
    const { driver } = openDatabase({ dir });
    const workspaces = createWorkspaceRepository(driver);
    const findings = createFindingsRepository(driver);
    const ws = workspaces.upsertByRootPath('/repo', 'repo');
    findings.replaceForFile(ws.id, 'a.ts', [
      {
        id: '1',
        source: 'eslint',
        ruleId: 'r',
        severity: 'error',
        category: 'correctness',
        location: { file: 'a.ts', startLine: 1, startCol: 1, endLine: 1, endCol: 2 },
        message: 'm',
        evidence: { snippet: 's', relatedLocations: [], toolOutput: null },
        fixable: false,
        repair: 'ai-required',
        confidence: 1,
      },
    ]);
    workspaces.remove(ws.id);
    expect(findings.countForWorkspace(ws.id)).toBe(0);
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

  it('retains at most 100 newest Zappr conversations per workspace', () => {
    const { driver } = openDatabase({ dir });
    const workspaces = createWorkspaceRepository(driver);
    const first = workspaces.upsertByRootPath('/repo-a', 'repo-a');
    const second = workspaces.upsertByRootPath('/repo-b', 'repo-b');
    const conversations = createZapprConversationRepository(driver);

    conversations.save('other-1', second.id, '["kept"]', null);
    conversations.save('other-2', second.id, '["kept"]', null);
    for (let index = 0; index < 105; index += 1) {
      conversations.save(`conversation-${String(index).padStart(3, '0')}`, first.id, '[]', null);
    }

    const kept = conversations.recent(first.id, 200);
    expect(kept).toHaveLength(100);
    expect(kept.map((row) => row.id)).toEqual(
      Array.from(
        { length: 100 },
        (_, index) => `conversation-${String(index + 5).padStart(3, '0')}`,
      ).reverse(),
    );
    expect(conversations.recent(second.id, 200).map((row) => row.id)).toEqual([
      'other-2',
      'other-1',
    ]);
    driver.close();
  });

  it('does not prune under the cap and keeps normal save/load data unchanged', () => {
    const { driver } = openDatabase({ dir });
    const workspace = createWorkspaceRepository(driver).upsertByRootPath('/repo', 'repo');
    const conversations = createZapprConversationRepository(driver);
    conversations.save('conversation-1', workspace.id, '[{"role":"user"}]', 'summary');

    expect(conversations.recent(workspace.id)).toEqual([
      expect.objectContaining({
        id: 'conversation-1',
        workspaceId: workspace.id,
        messages: '[{"role":"user"}]',
        summary: 'summary',
      }),
    ]);
    expect(driver.prepare('SELECT COUNT(*) AS n FROM zappr_conversations').get()).toEqual({ n: 1 });
    driver.close();
  });

  it('keeps a saved conversation when retention cleanup fails', () => {
    const { driver } = openDatabase({ dir });
    const workspace = createWorkspaceRepository(driver).upsertByRootPath('/repo', 'repo');
    const flakyDriver: SqliteDriver = {
      exec: (sql: string) => {
        driver.exec(sql);
      },
      prepare: (sql: string) => {
        const statement = driver.prepare(sql);
        if (sql.includes('DELETE FROM zappr_conversations')) {
          return {
            ...statement,
            run: () => {
              throw new Error('cleanup failure');
            },
          };
        }
        return statement;
      },
      transaction: <T>(fn: () => T) => driver.transaction(fn),
      isHealthy: () => driver.isHealthy(),
      close: () => {
        driver.close();
      },
    };
    createZapprConversationRepository(flakyDriver).save('conversation-1', workspace.id, '[]', null);

    expect(driver.prepare('SELECT id FROM zappr_conversations').get()).toEqual({
      id: 'conversation-1',
    });
    driver.close();
  });
});
