import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it, beforeAll } from 'vitest';

/**
 * The preload is the one privileged script in a sandboxed renderer; it runs before first paint
 * on every window. It must not carry a runtime dependency.
 *
 * The M0 audit caught it carrying the *entire* zod library — 120 kB of a 121 kB bundle —
 * because it imported the schema-bearing barrel for a list of channel names. This test asserts
 * the property on the **shipped artifact**, which is the only check an attacker cannot route
 * around: ESLint sees source, dependency-cruiser cannot resolve the workspace subpath, but the
 * built file is the built file. If zod gets back in by any path, this fails.
 */

const OUT = join(import.meta.dirname, '..', 'out', 'preload', 'index.js');

describe('the shipped preload bundle', () => {
  let bundle = '';
  let bytes = 0;

  beforeAll(() => {
    // Build so the assertion reflects current source, never a stale artifact.
    execFileSync('npx', ['electron-vite', 'build'], {
      cwd: join(import.meta.dirname, '..'),
      stdio: 'ignore',
      shell: process.platform === 'win32',
    });
    bundle = readFileSync(OUT, 'utf8');
    bytes = statSync(OUT).size;
  });

  it('contains no zod runtime', () => {
    // zod's internal symbols. Any of them present means the schema library shipped.
    for (const symbol of ['ZodError', '$ZodString', '_zod', 'ZodObject']) {
      expect(bundle, `preload bundle unexpectedly contains ${symbol}`).not.toContain(symbol);
    }
  });

  it('stays small — a privileged script that runs before first paint (PRD §7 cold start)', () => {
    // Was 121 kB with zod; ~0.5 kB without. 8 kB is a generous ceiling that still screams if a
    // library sneaks back in, without being so tight it fails on a formatting change.
    expect(bytes).toBeLessThan(8 * 1024);
  });

  it('still exposes the bridge', () => {
    expect(bundle).toContain('exposeInMainWorld');
  });
});
