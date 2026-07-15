import { describe, expect, it } from 'vitest';

import { basename, dirname } from './path.js';

/**
 * The renderer's path helpers are pure string ops (invariant I2: no `node:path` in the sandbox).
 * These cases pin the boundaries the tree and tabs depend on — trailing slashes, nesting, and
 * top-level entries — so a "helpful" rewrite that reaches for `node:path` would break a test, not
 * the app.
 */
describe('basename', () => {
  it('returns the final segment of a nested path', () => {
    expect(basename('src/features/editor/editor-store.ts')).toBe('editor-store.ts');
  });

  it('returns the whole string for a top-level entry', () => {
    expect(basename('package.json')).toBe('package.json');
  });

  it('ignores a trailing slash on a directory path', () => {
    expect(basename('src/features/')).toBe('features');
  });

  it('returns the segment for a dotfile', () => {
    expect(basename('.github/workflows/ci.yml')).toBe('ci.yml');
  });
});

describe('dirname', () => {
  it('returns the parent directory of a nested path', () => {
    expect(dirname('src/features/editor/editor-store.ts')).toBe('src/features/editor');
  });

  it('returns empty string for a top-level entry', () => {
    expect(dirname('package.json')).toBe('');
  });

  it('ignores a trailing slash', () => {
    expect(dirname('src/features/')).toBe('src');
  });
});
