import { describe, expect, it } from 'vitest';

import { languageForPath } from './language.js';

describe('languageForPath', () => {
  it('maps the three deep languages and their common extensions', () => {
    expect(languageForPath('src/a.ts')).toBe('typescript');
    expect(languageForPath('src/a.tsx')).toBe('typescript');
    expect(languageForPath('src/a.mts')).toBe('typescript');
    expect(languageForPath('src/a.js')).toBe('javascript');
    expect(languageForPath('src/a.mjs')).toBe('javascript');
    expect(languageForPath('main.py')).toBe('python');
    expect(languageForPath('cmd/main.go')).toBe('go');
  });

  it('is case-insensitive on the extension', () => {
    expect(languageForPath('A.PY')).toBe('python');
  });

  it('returns null for an unsupported or extensionless path', () => {
    expect(languageForPath('README.md')).toBeNull();
    expect(languageForPath('Dockerfile')).toBeNull();
    expect(languageForPath('src/main.rs')).toBeNull();
  });
});
