import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
});
