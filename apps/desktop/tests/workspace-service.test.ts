import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { UserFacingError } from '@fixora/shared-types';
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

  /**
   * Beta audit A2, Recent Projects finding: opening a deleted/moved/renamed recent project used to
   * throw a bare, unwrapped `statSync` ENOENT — which the IPC router redacts to the generic
   * "Something went wrong handling that action." `open()` now routes through the same fs-error
   * translation layer (`fsTry`/`toFsError`, fs-errors.ts) every other filesystem operation uses, so
   * this produces the same kind of precise, actionable `UserFacingError` they do.
   */
  it('reports a helpful, authored error — not a raw/generic one — when the folder no longer exists', () => {
    const { service, driver } = makeService();
    const vanished = join(repo, 'this-folder-was-deleted');

    let caught: unknown;
    try {
      service.open(vanished);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(UserFacingError);
    const message = (caught as UserFacingError).message;
    expect(message).not.toMatch(/something went wrong/i);
    expect(message).toContain('this-folder-was-deleted');
    expect(message).toMatch(/no longer exists/i);
    driver.close();
  });

  it('never leaks the vanished folder\'s absolute path in the error message', () => {
    const { service, driver } = makeService();
    const vanished = join(repo, 'this-folder-was-deleted');

    let caught: unknown;
    try {
      service.open(vanished);
    } catch (error) {
      caught = error;
    }

    expect((caught as UserFacingError).message).not.toContain(repo);
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

  it('authorizes a picked path and treats a known recent as authorized, but nothing else', () => {
    const { service, driver } = makeService();
    // A path the renderer fabricated: never picked, not a recent → not authorized.
    expect(service.isUserAuthorized(repo)).toBe(false);
    // The user picks it in the native dialog → authorized for this session.
    service.authorize(repo);
    expect(service.isUserAuthorized(repo)).toBe(true);
    driver.close();
  });

  it('treats a folder already in recents as authorized in a later session', () => {
    // Session one: open the repo so it lands in the recents table.
    const first = makeService();
    first.service.authorize(repo);
    first.service.open(repo);
    first.driver.close();

    // Session two (fresh service, nothing picked yet): the recent is still authorized to re-open —
    // this is what makes "reopen recent" work without re-picking, while an unknown path stays refused.
    const second = makeService();
    expect(second.service.isUserAuthorized(repo)).toBe(true);
    expect(second.service.isUserAuthorized(join(repo, 'src'))).toBe(false);
    second.driver.close();
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

  describe('pinning recent projects (Sprint F2)', () => {
    it('opens with no pin by default', () => {
      const { service, driver } = makeService();
      service.open(repo);
      expect(service.recent()[0]?.pinnedAt).toBeNull();
      driver.close();
    });

    it('sorts a pinned project before more-recently-opened, unpinned ones', () => {
      const { service, driver } = makeService();
      const other = mkdtempSync(join(tmpdir(), 'fixora-ws-other-'));
      mkdirSync(join(other, 'x'), { recursive: true });

      const { workspace: repoWs } = service.open(repo);
      service.open(other); // opened more recently than repo

      // Before pinning, recency alone puts `other` first.
      expect(service.recent().map((w) => w.rootPath)).toEqual([other, repo]);

      service.setPinned(repoWs.id, true);
      expect(service.recent().map((w) => w.rootPath)).toEqual([repo, other]);
      expect(service.recent()[0]?.pinnedAt).not.toBeNull();

      driver.close();
      rmSync(other, { recursive: true, force: true });
    });

    it('unpins back to recency ordering', () => {
      const { service, driver } = makeService();
      const other = mkdtempSync(join(tmpdir(), 'fixora-ws-other-'));
      mkdirSync(join(other, 'x'), { recursive: true });

      const { workspace: repoWs } = service.open(repo);
      service.open(other);
      service.setPinned(repoWs.id, true);
      expect(service.recent().map((w) => w.rootPath)).toEqual([repo, other]);

      service.setPinned(repoWs.id, false);
      expect(service.recent().map((w) => w.rootPath)).toEqual([other, repo]);
      expect(service.recent().find((w) => w.rootPath === repo)?.pinnedAt).toBeNull();

      driver.close();
      rmSync(other, { recursive: true, force: true });
    });
  });
});
