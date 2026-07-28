import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { UserFacingError } from '@fixora/shared-types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  FileTooLargeError,
  SecretFileError,
  listDirectory,
  readTextFile,
  writeTextFile,
  verifyWrittenFile,
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

describe('writeTextFile (atomic write, happy path)', () => {
  it('writes and verifies a genuinely correct write end to end (no false positives)', () => {
    writeFileSync(join(root, 'src', 'verify-ok.ts'), 'const a = 1;\n');
    expect(() => {
      writeTextFile(root, 'src/verify-ok.ts', 'const a = 2;\n');
    }).not.toThrow();
    expect(readFileSync(join(root, 'src', 'verify-ok.ts'), 'utf8')).toBe('const a = 2;\n');
  });
});

/**
 * Write verification (Q3 data-integrity hardening, post-incident). `writeTextFile` is the ONE
 * function Repair's apply, Proceed's Accept, and a manual editor Save all go through (`ai:applyRepair`
 * and `fs:writeFile` both call it directly) — proving `verifyWrittenFile` here covers all three at
 * once, since it's the exact function `writeTextFile` calls right after its atomic rename. This is
 * NOT a fix for the Q3 file-corruption incident: that root cause remains unresolved and unreproduced
 * despite extensive live testing. This is a general safety net, independent of cause: Fixora must
 * never report a write as successful unless the bytes actually on disk match what was intended.
 *
 * These tests call `verifyWrittenFile` directly against a file whose on-disk content is pre-arranged
 * to be exactly what it would be if something else's write had landed in the gap between our rename
 * and our own read-back — rather than trying to mock/race the internals of `writeTextFile` itself.
 * That race is not something a same-process mock can faithfully simulate anyway: every step inside
 * `writeTextFile` between the rename and the read-back is a single synchronous call with no yield
 * point, so only a genuinely separate OS process could ever land a write in that window — which is
 * exactly the class of cause this guards against, whatever it turns out to be.
 */
describe('verifyWrittenFile (Q3 data-integrity hardening)', () => {
  it('1. does not throw when the on-disk content matches exactly (no false positives)', () => {
    const abs = join(root, 'src', 'verify-match.ts');
    writeFileSync(abs, 'const a = 2;\n');
    expect(() => {
      verifyWrittenFile(abs, 'src/verify-match.ts', 'const a = 2;\n');
    }).not.toThrow();
  });

  it('2. throws a UserFacingError when the on-disk bytes are mismatched', () => {
    const abs = join(root, 'src', 'verify-mismatch.ts');
    writeFileSync(abs, 'something completely different'); // what's actually on disk
    let caught: unknown;
    try {
      verifyWrittenFile(abs, 'src/verify-mismatch.ts', 'const a = 2;\n'); // what we intended
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(UserFacingError);
    const message = (caught as UserFacingError).message;
    expect(message).toContain('data-integrity');
    expect(message).not.toContain('something completely different'); // never echoes content
  });

  it('3. throws on the exact Q3 incident signature: correct length, all-NUL content', () => {
    const abs = join(root, 'src', 'verify-allzero.ts');
    const intended = 'const a = 2;\n';
    writeFileSync(abs, Buffer.alloc(Buffer.byteLength(intended, 'utf8'), 0)); // right length, all zero
    expect(() => {
      verifyWrittenFile(abs, 'src/verify-allzero.ts', intended);
    }).toThrow(UserFacingError);
  });

  it('4. throws when the on-disk content is truncated relative to what was intended', () => {
    const abs = join(root, 'src', 'verify-truncated.ts');
    writeFileSync(abs, 'const'); // only the start survives
    expect(() => {
      verifyWrittenFile(abs, 'src/verify-truncated.ts', 'const a = 2;\n');
    }).toThrow(UserFacingError);
  });

  it("5. throws when the mismatch looks like a legitimate external edit — doesn't try to guess intent", () => {
    const abs = join(root, 'src', 'verify-external.ts');
    // Plausible, well-formed code — not corruption-looking. The point: verification does not try to
    // distinguish "malicious/broken" from "a real external edit landed here" — either way, OUR write
    // must not be reported as successful, and the external content must not be touched by us.
    const externalEdit = 'const a = 42; // edited in another program\n';
    writeFileSync(abs, externalEdit);
    expect(() => {
      verifyWrittenFile(abs, 'src/verify-external.ts', 'const a = 2;\n');
    }).toThrow(UserFacingError);
    // No auto-rollback: verifyWrittenFile only reads and compares, never writes — the external edit
    // is left completely untouched. Silently overwriting it could destroy real, legitimate work.
    expect(readFileSync(abs, 'utf8')).toBe(externalEdit);
  });

  it('never includes file content in the thrown message, only lengths/hashes', () => {
    const abs = join(root, 'src', 'verify-secret.ts');
    const secretLooking = 'const API_KEY = "sk-should-never-be-logged-anywhere";\n';
    writeFileSync(abs, secretLooking);
    let caught: unknown;
    try {
      verifyWrittenFile(abs, 'src/verify-secret.ts', 'const a = 2;\n');
    } catch (error) {
      caught = error;
    }
    expect((caught as UserFacingError).message).not.toContain('sk-should-never-be-logged');
  });
});
