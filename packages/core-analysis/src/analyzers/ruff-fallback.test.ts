import { describe, expect, it } from 'vitest';

import { resolveBundledBinary } from '../tools/resolve.js';

import { FALLBACK_RUFF_RULES, RUFF_VENDOR_PATH } from './ruff.js';

/**
 * Regression tests for tier 2 Python support.
 *
 * These guard the two things most likely to be quietly broken by a later change: the rule selection
 * (where adding a convenient-looking `E` would flood users with formatting noise) and the resolution
 * order (where letting the bundled binary win would contradict a project's own ruff config, which is
 * the thing ADR-007 exists to forbid).
 */

describe('bundled Ruff rule selection', () => {
  it('selects pyflakes, which is where the provable defects are', () => {
    expect(FALLBACK_RUFF_RULES.split(',')).toContain('F');
  });

  it('never selects pycodestyle or isort', () => {
    // Engineering Spec Section 11: every bundled rule must flag a defect, not a preference. Line
    // length and import order are conventions, and on a real project they would be the loudest thing
    // on screen — which is how an analyzer the user never asked to run loses their trust.
    const selected = FALLBACK_RUFF_RULES.split(',');
    for (const rule of selected) {
      expect(rule.startsWith('E'), `${rule} is pycodestyle`).toBe(false);
      expect(rule.startsWith('W'), `${rule} is pycodestyle`).toBe(false);
      expect(rule.startsWith('I'), `${rule} is isort`).toBe(false);
    }
  });

  it('picks bugbear rules individually rather than enabling the whole family', () => {
    // Bare `B` would pull in judgement calls alongside the real bugs.
    const selected = FALLBACK_RUFF_RULES.split(',');
    expect(selected).not.toContain('B');
    expect(selected).toContain('B006'); // mutable default argument — a genuine, silent bug
  });
});

describe('bundled binary resolution', () => {
  it('reports the platform-appropriate vendored path', () => {
    expect(RUFF_VENDOR_PATH).toBe(
      process.platform === 'win32' ? 'vendor/ruff/ruff.exe' : 'vendor/ruff/ruff',
    );
  });

  it('returns null rather than throwing when the vendor step has not run', () => {
    // A developer who has not vendored still gets tier 1. Absence is not an error here — treating it
    // as one would make the whole engine fail on a machine that simply has not built yet.
    expect(resolveBundledBinary('vendor/does-not-exist/nope.exe')).toBeNull();
  });

  it('returns null rather than throwing when the package itself cannot be resolved', () => {
    expect(
      resolveBundledBinary('vendor/ruff/ruff.exe', () => {
        throw new Error('not resolvable');
      }),
    ).toBeNull();
  });
});
