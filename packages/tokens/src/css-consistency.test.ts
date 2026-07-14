import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, beforeAll } from 'vitest';

/**
 * The M0 audit shipped with two bugs this test now makes impossible:
 *   1. `theme.css` mapped `--color-on-solid` to `--fx-color-text-on-solid`, which no longer
 *      existed — a dangling reference that renders as an invalid (ignored) value.
 *   2. the status `onSolid` vars were emitted camelCase (`...-onSolid`), out of step with every
 *      other kebab-case token and unreachable by the Tailwind mapping.
 *
 * Both are the same class of failure: the generator and its own output drifting apart with no
 * compiler to notice. So the generator's output is asserted here — every `var(--fx-*)` the
 * theme references must be a variable the tokens actually define.
 */

const DIST = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');

function definedVars(css: string): Set<string> {
  return new Set([...css.matchAll(/^\s*(--fx-[a-z0-9-]+)\s*:/gm)].map((m) => m[1] as string));
}

function referencedVars(css: string): string[] {
  return [...css.matchAll(/var\((--fx-[A-Za-z0-9-]+)\)/g)].map((m) => m[1] as string);
}

describe('generated token CSS', () => {
  let tokensCss = '';
  let themeCss = '';

  beforeAll(() => {
    // Build from source so the test reflects the current generator, never a stale dist/.
    execFileSync('npx', ['tsx', 'scripts/build-css.ts'], {
      cwd: join(DIST, '..'),
      stdio: 'ignore',
      shell: process.platform === 'win32',
    });
    tokensCss = readFileSync(join(DIST, 'tokens.css'), 'utf8');
    themeCss = readFileSync(join(DIST, 'theme.css'), 'utf8');
  });

  it('every variable theme.css references is defined in tokens.css', () => {
    const defined = definedVars(tokensCss);
    const dangling = referencedVars(themeCss).filter((v) => !defined.has(v));
    expect(dangling).toEqual([]);
  });

  it('emits only kebab-case custom properties', () => {
    const camel = [...definedVars(tokensCss)].filter((v) => /[A-Z]/.test(v));
    expect(camel).toEqual([]);
  });

  it('defines the dark theme by overriding, and light as the base', () => {
    // A regression here means one theme silently falls back to the other's colours.
    expect(tokensCss).toContain(":root[data-theme='dark']");
    expect(tokensCss).toMatch(/@media \(prefers-color-scheme: dark\)/);
  });

  it('collapses motion under prefers-reduced-motion', () => {
    // Design Review §2.4: gated centrally so a component cannot forget.
    expect(tokensCss).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
  });
});
