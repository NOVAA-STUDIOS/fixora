import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { UserFacingError } from '@fixora/shared-types';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { toFsError, fsTry } from '../electron/main/services/fs/fs-errors.js';
import {
  listDirectory,
  readTextFile,
  writeTextFile,
} from '../electron/main/services/fs/fs-service.js';
import { loadIgnoreRules } from '../electron/main/services/fs/ignore-rules.js';

/**
 * Filesystem reliability.
 *
 * Every fs call in fs-service was unguarded, so routine Windows conditions — a file open in another
 * editor, a cloud-sync placeholder, a deleted file — threw raw Node errors that the router redacted
 * to "Something went wrong handling that action." These pin the translation, and pin the symlink
 * policy that fs-service and analysis now share.
 *
 * `toFsError` is exercised with synthetic errno values because provoking a real ENOSPC or EMFILE in
 * a unit test is not feasible. The conditions that CAN be produced for real — missing file, symlink,
 * directory, read-only — are produced for real against a temp directory.
 */
describe('toFsError — errno translation', () => {
  const err = (code: string): { code: string } => ({ code });

  it('names the situation, never the errno, for every mapped code', () => {
    const cases: [string, string][] = [
      ['EBUSY', 'another program is holding it open'],
      ['EPERM', 'Windows refused'],
      ['EACCES', 'does not have permission'],
      ['ENOENT', 'no longer exists'],
      ['EMFILE', 'ran out of file handles'],
      ['ENOSPC', 'no disk space'],
      ['EROFS', 'read-only filesystem'],
      ['ELOOP', 'points to itself'],
    ];
    for (const [code, phrase] of cases) {
      const out = toFsError(err(code), 'read', 'src/a.ts');
      expect(out, code).toBeInstanceOf(UserFacingError);
      expect(out.message, code).toContain(phrase);
      // The raw errno must not be the thing the user is shown.
      expect(out.message, code).not.toContain(code);
    }
  });

  it('gives each condition a distinct code, so the UI can act differently', () => {
    const codes = ['EBUSY', 'EPERM', 'EACCES', 'ENOENT', 'ENOSPC'].map(
      (c) => toFsError(err(c), 'read', 'x').options.code,
    );
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('offers retry for transient conditions and not for permanent ones', () => {
    // A retry button on "the file is gone" is a lie; on "another program has it" it is the fix.
    expect(toFsError(err('EBUSY'), 'read', 'x').options.action?.type).toBe('retry');
    expect(toFsError(err('ENOENT'), 'read', 'x').options.action?.type).toBe('none');
  });

  it('still authors a message for an unknown errno, and keeps the code for maintainers', () => {
    const out = toFsError(err('EWEIRD'), 'read', 'src/a.ts');
    expect(out.message).toContain('src/a.ts');
    expect(out.message).toContain('EWEIRD');
    expect(out.message).not.toContain('Something went wrong');
  });

  it('handles a non-Error throw without losing the path', () => {
    expect(toFsError('just a string', 'read', 'src/a.ts').message).toContain('src/a.ts');
  });

  it('never leaks an absolute path into the message', () => {
    // The message crosses to the renderer; an absolute path is user data (Security §9).
    const out = toFsError(err('EPERM'), 'read', 'src/a.ts');
    expect(out.message).not.toMatch(/[A-Z]:\\/);
    expect(out.message).not.toContain('/Users/');
    expect(out.message).not.toContain('/home/');
  });
});

describe('fsTry', () => {
  it('passes an already-authored error through unflattened', () => {
    const authored = new UserFacingError('This file is a secret and will not be read.', {
      code: 'secret_file',
    });
    expect(() =>
      fsTry('read', 'x', () => {
        throw authored;
      }),
    ).toThrow(authored);
  });

  it('returns the value when nothing throws', () => {
    expect(fsTry('read', 'x', () => 42)).toBe(42);
  });
});

describe('fs-service — real filesystem conditions', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'fx-fs-'));
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'src', 'a.ts'), 'export const a = 1;\n');
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('reports a missing file as gone, not as an unexplained failure', () => {
    try {
      readTextFile(root, 'src/missing.ts');
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(UserFacingError);
      expect((e as UserFacingError).options.code).toBe('fs_not_found');
      expect((e as UserFacingError).message).toContain('no longer exists');
    }
  });

  it('reports a missing directory listing as an authored error', async () => {
    try {
      await listDirectory(root, 'does-not-exist', loadIgnoreRules(root));
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(UserFacingError);
      expect((e as UserFacingError).options.code).toBe('fs_not_found');
    }
  });

  it('reads a file normally when nothing is wrong', () => {
    expect(readTextFile(root, 'src/a.ts').content).toBe('export const a = 1;\n');
  });

  it('writes a file normally when nothing is wrong', () => {
    writeTextFile(root, 'src/a.ts', 'export const a = 2;\n');
    expect(readTextFile(root, 'src/a.ts').content).toBe('export const a = 2;\n');
  });

  /**
   * The asymmetry this sprint fixed: analysis skips symlinks, so fs-service must not write through
   * one. Symlink creation needs privilege on Windows (or Developer Mode), so this reports honestly
   * when it could not exercise the path — a skipped assertion is truthful, a green test that never
   * created a link is not.
   */
  it('refuses to WRITE through a symlink, because analysis never checked the target', () => {
    let linked = false;
    try {
      writeFileSync(join(root, 'real.ts'), 'export const real = 1;\n');
      symlinkSync(join(root, 'real.ts'), join(root, 'link.ts'), 'file');
      linked = true;
    } catch {
      // No symlink privilege on this machine.
    }
    if (!linked) {
      console.warn('[fs-errors] symlink creation unavailable — write-through path NOT exercised');
      return;
    }
    try {
      writeTextFile(root, 'link.ts', 'export const real = 2;\n');
      expect.unreachable('should have refused');
    } catch (e) {
      expect(e).toBeInstanceOf(UserFacingError);
      expect((e as UserFacingError).options.code).toBe('fs_symlink_write');
    }
    // THE INVARIANT: the real file behind the link is untouched.
    expect(readTextFile(root, 'real.ts').content).toBe('export const real = 1;\n');
  });

  it('still allows READING through a symlink', () => {
    let linked = false;
    try {
      writeFileSync(join(root, 'real2.ts'), 'export const r = 1;\n');
      symlinkSync(join(root, 'real2.ts'), join(root, 'link2.ts'), 'file');
      linked = true;
    } catch {
      /* no privilege */
    }
    if (!linked) {
      console.warn('[fs-errors] symlink creation unavailable — read-through path NOT exercised');
      return;
    }
    expect(readTextFile(root, 'link2.ts').content).toBe('export const r = 1;\n');
  });

  it('refuses to read a directory as a file', () => {
    try {
      readTextFile(root, 'src');
      expect.unreachable('should have thrown');
    } catch (e) {
      expect((e as UserFacingError).options.code).toBe('is_a_directory');
    }
  });

  it('refuses to write over a directory', () => {
    try {
      writeTextFile(root, 'src', 'nope');
      expect.unreachable('should have thrown');
    } catch (e) {
      expect((e as UserFacingError).options.code).toBe('is_a_directory');
    }
  });

  it('reports a read-only file as an authored error, never a crash', () => {
    const file = join(root, 'src', 'ro.ts');
    writeFileSync(file, 'export const x = 1;\n');
    chmodSync(file, 0o444);
    try {
      writeTextFile(root, 'src/ro.ts', 'changed');
      // POSIX-as-root, and some Windows configurations, will simply succeed. That is a real
      // outcome, not a test failure — what must never happen is an UNAUTHORED error.
    } catch (e) {
      expect(e).toBeInstanceOf(UserFacingError);
      expect(['fs_permission', 'fs_access_denied', 'fs_read_only']).toContain(
        (e as UserFacingError).options.code,
      );
    } finally {
      chmodSync(file, 0o644);
    }
  });

  /**
   * Atomicity (requirement §8): a repair either applies fully or not at all. The write goes to a
   * sibling temp file and is renamed over the target, so a failure cannot leave the source truncated.
   */
  it('applies a repair via an atomic replace and leaves no temp files behind', () => {
    writeTextFile(root, 'src/a.ts', 'export const a = 99;\n');
    expect(readTextFile(root, 'src/a.ts').content).toBe('export const a = 99;\n');
    // The temp file (.<hex>.fixora-tmp) must not survive a successful write.
    const leftovers = readdirSync(join(root, 'src')).filter((n) => n.includes('fixora-tmp'));
    expect(leftovers).toEqual([]);
  });

  it('leaves the original file completely intact if the write cannot be completed', () => {
    const file = join(root, 'src', 'keep.ts');
    const original = 'export const keep = 1;\n';
    writeFileSync(file, original);
    chmodSync(file, 0o444); // read-only: on Windows the rename-over fails; the original must survive
    let threw = false;
    try {
      writeTextFile(root, 'src/keep.ts', 'export const keep = 2;\n');
    } catch (e) {
      threw = true;
      expect(e).toBeInstanceOf(UserFacingError); // authored, never a raw crash
    } finally {
      chmodSync(file, 0o644);
    }
    // Whether the platform refused the write or allowed it, the file is never a partial mix: it is
    // either the full original or the full replacement, and no temp file is orphaned.
    const after = readFileSync(file, 'utf8');
    expect([original, 'export const keep = 2;\n']).toContain(after);
    if (threw) expect(after).toBe(original);
    const leftovers = readdirSync(join(root, 'src')).filter((n) => n.includes('fixora-tmp'));
    expect(leftovers).toEqual([]);
  });
});
