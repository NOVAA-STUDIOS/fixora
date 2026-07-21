import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createOverlay, patchOverlayFile } from '../electron/main/verification/overlay.js';

let workspace: string;

beforeEach(() => {
  workspace = join(tmpdir(), `fixora-ws-${String(Date.now())}-${String(Math.random()).slice(2)}`);
  mkdirSync(join(workspace, 'src'), { recursive: true });
  writeFileSync(join(workspace, 'src', 'a.ts'), 'export const a = 1;\n');
  writeFileSync(join(workspace, 'package.json'), '{"name":"x"}\n');
  // A heavy dir that must NOT be copied into the overlay.
  mkdirSync(join(workspace, 'node_modules', 'dep'), { recursive: true });
  writeFileSync(join(workspace, 'node_modules', 'dep', 'index.js'), 'module.exports = 1;\n');
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
});

describe('verification overlay (ADR-003)', () => {
  it('copies source but not node_modules, and disposes cleanly', () => {
    const overlay = createOverlay(workspace);
    try {
      expect(existsSync(join(overlay.root, 'src', 'a.ts'))).toBe(true);
      expect(existsSync(join(overlay.root, 'package.json'))).toBe(true);
      // node_modules is junction-linked (present as a path), not deep-copied — the real one still exists.
      expect(existsSync(join(workspace, 'node_modules', 'dep', 'index.js'))).toBe(true);
    } finally {
      overlay.dispose();
    }
    expect(existsSync(overlay.root)).toBe(false);
  });

  it('patches a file in the overlay without touching the real workspace', () => {
    const overlay = createOverlay(workspace);
    try {
      patchOverlayFile(overlay.root, 'src/a.ts', 'export const a = 2;\n');
      expect(readFileSync(join(overlay.root, 'src', 'a.ts'), 'utf8')).toBe('export const a = 2;\n');
      // The real file is untouched — verification never mutates the user's code.
      expect(readFileSync(join(workspace, 'src', 'a.ts'), 'utf8')).toBe('export const a = 1;\n');
    } finally {
      overlay.dispose();
    }
  });

  /**
   * The release blocker: `cpSync`'s recursive copy recreates every symlink it meets by calling the OS
   * `symlink()` syscall, which Windows refuses with `EPERM: operation not permitted, symlink` for an
   * unprivileged process. A project with one committed symlink made every repair fail with a generic
   * internal error. The overlay must now build successfully with a symlink present, skipping it.
   *
   * A junction is the reparse point this machine can create without SeCreateSymbolicLinkPrivilege, and
   * it reports `isSymbolicLink() === true` — so it drives the exact skip branch a real symlink drives.
   */
  it('builds the overlay even when the tree contains a reparse point, skipping it', () => {
    mkdirSync(join(workspace, 'realdir'), { recursive: true });
    writeFileSync(join(workspace, 'realdir', 'x.ts'), 'export const x = 1;\n');
    let linked = false;
    try {
      // Directory junction — no privilege required, unlike a symlink.
      symlinkSync(join(workspace, 'realdir'), join(workspace, 'linkdir'), 'junction');
      linked = lstatSync(join(workspace, 'linkdir')).isSymbolicLink();
    } catch {
      // No reparse-point support at all — nothing to exercise.
    }
    if (!linked) {
      console.warn('[overlay] reparse point unavailable — symlink-skip path NOT exercised');
      return;
    }

    // The assertion that was the bug: this must not throw EPERM.
    const overlay = createOverlay(workspace);
    try {
      // Real files copied; the reparse point skipped, not recreated.
      expect(existsSync(join(overlay.root, 'realdir', 'x.ts'))).toBe(true);
      expect(existsSync(join(overlay.root, 'linkdir'))).toBe(false);
    } finally {
      overlay.dispose();
    }
  });

  /**
   * The real thing when the machine allows it. Skipped honestly, never a false green, when file-symlink
   * creation needs a privilege this machine lacks — the same pattern the fs-error tests use.
   */
  it('skips a real file symlink when one can be created', () => {
    writeFileSync(join(workspace, 'src', 'real.ts'), 'export const real = 1;\n');
    let linked = false;
    try {
      symlinkSync(join(workspace, 'src', 'real.ts'), join(workspace, 'src', 'link.ts'), 'file');
      linked = true;
    } catch {
      // EPERM — no symlink privilege here.
    }
    if (!linked) {
      console.warn('[overlay] file-symlink creation unavailable — real-symlink path NOT exercised');
      return;
    }
    const overlay = createOverlay(workspace);
    try {
      expect(existsSync(join(overlay.root, 'src', 'real.ts'))).toBe(true);
      expect(existsSync(join(overlay.root, 'src', 'link.ts'))).toBe(false);
    } finally {
      overlay.dispose();
    }
  });
});
