import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { openDatabase } from '../electron/main/db/database.js';
import {
  createFileIndexRepository,
  createWorkspaceRepository,
} from '../electron/main/db/repositories.js';
import { createWorkspaceService } from '../electron/main/services/workspace-service.js';

let dbDir: string;
let repo: string;

beforeEach(() => {
  dbDir = mkdtempSync(join(tmpdir(), 'fixora-ws-db-'));
  repo = mkdtempSync(join(tmpdir(), 'fixora-ws-repo-'));
  mkdirSync(join(repo, 'src'));
  mkdirSync(join(repo, 'node_modules'));
  writeFileSync(join(repo, '.gitignore'), 'ignored.txt\n');
  writeFileSync(join(repo, 'src', 'a.ts'), 'export const a = 1;');
  writeFileSync(join(repo, 'src', 'b.go'), 'package main');
  writeFileSync(join(repo, 'ignored.txt'), 'skip me');
  writeFileSync(join(repo, 'node_modules', 'dep.js'), 'noise');
});
afterEach(() => {
  rmSync(dbDir, { recursive: true, force: true });
  rmSync(repo, { recursive: true, force: true });
});

function makeService() {
  const { driver } = openDatabase({ dir: dbDir });
  const service = createWorkspaceService({
    workspaces: createWorkspaceRepository(driver),
    files: createFileIndexRepository(driver),
  });
  return { service, driver };
}

describe('workspace service', () => {
  it('opens a folder and becomes the current workspace', () => {
    const { service, driver } = makeService();
    const { workspace } = service.open(repo);
    expect(workspace.rootPath).toBe(repo);
    expect(service.getCurrent()?.rootPath).toBe(repo);
    driver.close();
  });

  it('refuses to open a file as a workspace', () => {
    const { service, driver } = makeService();
    expect(() => service.open(join(repo, 'src', 'a.ts'))).toThrow(/folder/);
    driver.close();
  });

  it('records recents most-recent-first without duplicating a re-open', () => {
    const { service, driver } = makeService();
    const other = mkdtempSync(join(tmpdir(), 'fixora-ws-other-'));
    mkdirSync(join(other, 'x'), { recursive: true });
    service.open(repo);
    service.open(other);
    service.open(repo); // re-open bumps recency, no duplicate
    expect(service.recent().map((w) => w.rootPath)).toEqual([repo, other]);
    driver.close();
    rmSync(other, { recursive: true, force: true });
  });

  it('indexes files, honouring ignore rules (no node_modules, no .gitignore matches)', () => {
    const { service, driver } = makeService();
    service.open(repo);
    const open = service.requireRoot();
    const count = service.indexFiles(open);
    // src/a.ts, src/b.go, and .gitignore itself — but NOT ignored.txt or node_modules/dep.js.
    const paths = driver
      .prepare('SELECT rel_path FROM files_index ORDER BY rel_path')
      .all()
      .map((r) => r['rel_path']);
    expect(paths).toContain('src/a.ts');
    expect(paths).toContain('src/b.go');
    expect(paths).not.toContain('ignored.txt');
    expect(paths.some((p) => String(p).includes('node_modules'))).toBe(false);
    expect(count).toBe(paths.length);
    driver.close();
  });

  it('gives every indexed source file a content hash and language', () => {
    const { service, driver } = makeService();
    service.open(repo);
    service.indexFiles(service.requireRoot());
    const row = driver
      .prepare('SELECT language, content_hash FROM files_index WHERE rel_path = ?')
      .get('src/a.ts');
    expect(row?.['language']).toBe('typescript');
    expect(typeof row?.['content_hash']).toBe('string');
    driver.close();
  });
});
