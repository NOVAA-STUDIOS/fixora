import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  assertInsideWorkspace,
  isInsideBoundary,
  PathOutsideWorkspaceError,
} from '../electron/main/services/fs/path-guard.js';

/**
 * The path guard is a security boundary, so it is tested "property-based, not example-based" per
 * Testing §2: fuzzed traversal strings against the pure boundary check, plus **real symlinks and
 * junctions** in a temp workspace against the resolving guard — because a guard that has never
 * been pointed at an actual symlink escape is a guard nobody has tested.
 */

describe('isInsideBoundary (pure segment check)', () => {
  const root = join(sep, 'workspace');

  it('accepts the root and paths beneath it', () => {
    expect(isInsideBoundary(root, root)).toBe(true);
    expect(isInsideBoundary(join(root, 'src', 'a.ts'), root)).toBe(true);
    expect(isInsideBoundary(join(root, 'deeply', 'nested', 'file'), root)).toBe(true);
  });

  it('rejects the sibling-prefix trick (/workspace-evil starts-with /workspace)', () => {
    expect(isInsideBoundary(join(sep, 'workspace-evil'), root)).toBe(false);
    expect(isInsideBoundary(join(sep, 'workspace-evil', 'x'), root)).toBe(false);
  });

  it('rejects an escape via ..', () => {
    expect(isInsideBoundary(join(root, '..', 'etc', 'passwd'), root)).toBe(false);
    expect(isInsideBoundary(join(sep, 'etc', 'passwd'), root)).toBe(false);
    expect(isInsideBoundary(join(sep), root)).toBe(false);
  });

  it('property: no generated traversal string escapes and reports inside', () => {
    // Fuzz: random ../ counts, random tails, mixed separators. None may be judged "inside".
    for (let i = 0; i < 500; i++) {
      const ups = '../'.repeat(1 + Math.floor(Math.random() * 6));
      const tails = ['etc/passwd', 'root/.ssh/id_rsa', 'x', 'a/b/c'];
      const tail = tails[Math.floor(Math.random() * tails.length)] ?? 'x';
      const candidate = join(root, ups + tail);
      // join() collapses the ..; anything that lands outside root must be rejected.
      const rel = candidate.startsWith(root + sep) || candidate === root;
      expect(isInsideBoundary(candidate, root)).toBe(rel);
    }
  });
});

describe('assertInsideWorkspace (resolves real paths, follows links)', () => {
  let tmp: string;
  let root: string;
  let outside: string;

  beforeAll(() => {
    tmp = mkdtempSync(join(tmpdir(), 'fixora-guard-'));
    root = join(tmp, 'workspace');
    outside = join(tmp, 'outside');
    mkdirSync(join(root, 'src'), { recursive: true });
    mkdirSync(outside, { recursive: true });
    writeFileSync(join(root, 'src', 'a.ts'), 'export const a = 1;');
    writeFileSync(join(outside, 'secret.txt'), 'TOP SECRET');
  });

  afterAll(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('accepts a real file inside the workspace', () => {
    expect(() => assertInsideWorkspace(join(root, 'src', 'a.ts'), root)).not.toThrow();
  });

  it('accepts a not-yet-existing file inside the workspace', () => {
    expect(() => assertInsideWorkspace(join(root, 'src', 'new-file.ts'), root)).not.toThrow();
  });

  it('rejects a real file outside the workspace', () => {
    expect(() => assertInsideWorkspace(join(outside, 'secret.txt'), root)).toThrow(
      PathOutsideWorkspaceError,
    );
  });

  it('rejects a traversal that resolves outside', () => {
    expect(() => assertInsideWorkspace(join(root, '..', 'outside', 'secret.txt'), root)).toThrow(
      PathOutsideWorkspaceError,
    );
  });

  it('rejects a SYMLINK inside the workspace that points outside it', () => {
    // The realistic attack: a repo you cloned contains a symlink `link -> /etc` (or here,
    // -> the outside dir). Reading through it must be refused even though the link lives inside.
    const link = join(root, 'escape-link');
    try {
      symlinkSync(outside, link, 'junction'); // junction works on Windows without privilege
    } catch {
      // If even a junction cannot be created in this environment, skip rather than false-pass.
      return;
    }
    expect(() => assertInsideWorkspace(join(link, 'secret.txt'), root)).toThrow(
      PathOutsideWorkspaceError,
    );
  });

  it('the error never carries the resolved path, only that it was refused', () => {
    try {
      assertInsideWorkspace(join(outside, 'secret.txt'), root);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(PathOutsideWorkspaceError);
      expect((error as PathOutsideWorkspaceError).code).toBe('PATH_OUTSIDE_WORKSPACE');
      expect((error as Error).message).not.toContain('secret');
    }
  });
});
