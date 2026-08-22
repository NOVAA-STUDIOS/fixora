import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
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

const DESKTOP = join(import.meta.dirname, '..');
const OUT = join(DESKTOP, 'out', 'preload', 'index.js');
const PRELOAD_SRC = join(DESKTOP, 'electron', 'preload');

/**
 * Rebuild only if the shipped preload is missing or older than its source. Electron-vite has no
 * per-target build, and building all three targets now drags in Monaco's multi-megabyte renderer —
 * far too slow to run on every test invocation. In CI, `pnpm build` runs before `pnpm test`, so the
 * artifact is already fresh and this never rebuilds; locally, it rebuilds only when the preload
 * source actually changed, keeping the artifact honest without the cost.
 */
function isStale(): boolean {
  if (!existsSync(OUT)) return true;
  const builtAt = statSync(OUT).mtimeMs;
  const newest = readdirSync(PRELOAD_SRC).reduce((max, name) => {
    return Math.max(max, statSync(join(PRELOAD_SRC, name)).mtimeMs);
  }, 0);
  return newest > builtAt;
}

describe('the shipped preload bundle', () => {
  let bundle = '';
  let bytes = 0;

  beforeAll(() => {
    if (isStale()) {
      execFileSync('npx', ['electron-vite', 'build'], {
        cwd: DESKTOP,
        stdio: 'ignore',
        shell: process.platform === 'win32',
      });
    }
    bundle = readFileSync(OUT, 'utf8');
    bytes = statSync(OUT).size;
  }, 300_000);

  it('contains no zod runtime', () => {
    // zod's internal symbols. Any of them present means the schema library shipped.
    for (const symbol of ['ZodError', '$ZodString', '_zod', 'ZodObject']) {
      expect(bundle, `preload bundle unexpectedly contains ${symbol}`).not.toContain(symbol);
    }
  });

  it('stays small — a privileged script that runs before first paint (PRD §7 cold start)', () => {
    // Was 121 kB with zod; ~0.5 kB without. 10 kB is a generous ceiling that still screams if a
    // library sneaks back in, without being so tight it fails as the channel list legitimately
    // grows with each new IPC channel (raised from 8 kB once real channel-name growth hit it).
    expect(bytes).toBeLessThan(10 * 1024);
  });

  it('still exposes the bridge', () => {
    expect(bundle).toContain('exposeInMainWorld');
  });
});
