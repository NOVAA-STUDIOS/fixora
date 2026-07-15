import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  FileTooLargeError,
  SecretFileError,
  listDirectory,
  readTextFile,
} from '../electron/main/services/fs/fs-service.js';
import { loadIgnoreRules } from '../electron/main/services/fs/ignore-rules.js';

let root: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'fixora-fs-'));
  mkdirSync(join(root, 'src'));
  mkdirSync(join(root, 'node_modules', 'pkg'), { recursive: true });
  mkdirSync(join(root, '.git'), { recursive: true });
  mkdirSync(join(root, 'dist'), { recursive: true });
  writeFileSync(join(root, '.gitignore'), 'dist/\n*.log\n');
  writeFileSync(join(root, 'src', 'a.ts'), 'export const a = 1;');
  writeFileSync(join(root, 'src', 'b.py'), 'b = 2');
  writeFileSync(join(root, 'README.md'), '# repo');
  writeFileSync(join(root, 'debug.log'), 'noise');
  writeFileSync(join(root, '.env'), 'SECRET=xyz');
  writeFileSync(join(root, 'node_modules', 'pkg', 'index.js'), 'module.exports = 1;');
  writeFileSync(join(root, 'dist', 'out.js'), 'built');
});
afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('listDirectory (lazy, ignore-aware, sorted)', () => {
  const ignore = () => loadIgnoreRules(root);

  it('lists the root: dirs first, ignored entries hidden', () => {
    const names = listDirectory(root, '', ignore()).map((e) => `${e.kind}:${e.name}`);
    // src/ is a dir and comes first; node_modules, .git, dist and *.log are ignored;
    // .env is shown in the tree (it is denied on *read*, not hidden from listing) — but the
    // always-ignore + .gitignore hide node_modules/.git/dist and debug.log.
    expect(names).toContain('dir:src');
    expect(names).toContain('file:README.md');
    expect(names).not.toContain('dir:node_modules');
    expect(names).not.toContain('dir:.git');
    expect(names).not.toContain('dir:dist');
    expect(names).not.toContain('file:debug.log');
    // Directories sort before files.
    expect(names.indexOf('dir:src')).toBeLessThan(names.indexOf('file:README.md'));
  });

  it('detects language on files', () => {
    const entries = listDirectory(root, 'src', ignore());
    expect(entries.find((e) => e.name === 'a.ts')?.language).toBe('typescript');
    expect(entries.find((e) => e.name === 'b.py')?.language).toBe('python');
  });
});

describe('readTextFile (guarded, denylisted)', () => {
  it('reads a normal source file', () => {
    const file = readTextFile(root, 'src/a.ts');
    expect(file.content).toBe('export const a = 1;');
    expect(file.language).toBe('typescript');
  });

  it('refuses a secret file even though it is listable', () => {
    expect(() => readTextFile(root, '.env')).toThrow(SecretFileError);
  });

  it('refuses a path that escapes the workspace', () => {
    expect(() => readTextFile(root, '../outside.txt')).toThrow();
  });

  it('refuses a file above the text size ceiling', () => {
    const big = join(root, 'big.bin');
    writeFileSync(big, Buffer.alloc(9 * 1024 * 1024, 0));
    try {
      expect(() => readTextFile(root, 'big.bin')).toThrow(FileTooLargeError);
    } finally {
      rmSync(big, { force: true });
    }
  });
});
