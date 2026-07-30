import { isRepairSupportedPath } from '@fixora/shared-types';
import { describe, expect, it } from 'vitest';

import { languageFor } from '../electron/main/ai/ai-service.js';

/**
 * Bug-fix sprint, Phase 1: `languageFor`'s extension map (used by both Repair and Proceed, per its
 * own doc comment) had drifted from `packages/core-analysis/src/language.ts`'s `languageForPath` —
 * missing `pyi` and `json`. The Analyzer happily produces findings for `.json` files (a real
 * `JsonAnalyzer` is registered and `.json` is repairable per `repair-eligibility.ts`'s
 * `REPAIRABLE_LANGUAGES`), but Repair and Proceed rejected them as "unsupported" because this map
 * never listed the extension. Pinned here so the two maps can't silently drift apart again.
 */
describe('languageFor', () => {
  it('recognizes the Tier-B web languages, so CSS/HTML findings are repairable', () => {
    // These were absent from every language map, which made them invisible to analysis and then
    // refused by Repair/Proceed as "unsupported". They are Tier-B validation languages now.
    expect(languageFor('styles.css')).toBe('css');
    expect(languageFor('index.html')).toBe('html');
    expect(languageFor('index.htm')).toBe('html');
  });

  it('recognizes every extension the Analyzer analyzes deeply, including json and pyi', () => {
    expect(languageFor('src/a.ts')).toBe('typescript');
    expect(languageFor('src/a.tsx')).toBe('typescript');
    expect(languageFor('src/a.mts')).toBe('typescript');
    expect(languageFor('src/a.cts')).toBe('typescript');
    expect(languageFor('src/a.js')).toBe('javascript');
    expect(languageFor('src/a.jsx')).toBe('javascript');
    expect(languageFor('src/a.mjs')).toBe('javascript');
    expect(languageFor('src/a.cjs')).toBe('javascript');
    expect(languageFor('src/a.py')).toBe('python');
    expect(languageFor('src/a.pyi')).toBe('python');
    expect(languageFor('src/a.go')).toBe('go');
    expect(languageFor('package.json')).toBe('json');
  });

  it('is case-insensitive on the extension', () => {
    expect(languageFor('src/A.TS')).toBe('typescript');
    expect(languageFor('src/A.JSON')).toBe('json');
  });

  it("agrees exactly with shared-types' repair-support map — the renderer's copy cannot drift", () => {
    // The renderer decides `unsupported` from `isRepairSupportedPath`; main decides it from
    // `languageFor`. If the two ever disagree, the UI offers Repair on a file main will refuse (or
    // hides it on one main would accept). This pins them equal in both directions.
    for (const ext of [
      'ts',
      'tsx',
      'mts',
      'cts',
      'js',
      'jsx',
      'mjs',
      'cjs',
      'py',
      'pyi',
      'go',
      'json',
      'css',
      'html',
      'htm',
    ]) {
      const file = `a.${ext}`;
      expect(languageFor(file) !== null, `${file}: main`).toBe(true);
      expect(isRepairSupportedPath(file), `${file}: renderer`).toBe(true);
    }
    for (const file of ['a.md', 'a.rb', 'a.yaml', 'a.java', 'a.txt']) {
      expect(languageFor(file), `${file}: main`).toBeNull();
      expect(isRepairSupportedPath(file), `${file}: renderer`).toBe(false);
    }
  });

  it('returns null for a genuinely unsupported extension', () => {
    expect(languageFor('README.md')).toBeNull();
    expect(languageFor('script.rb')).toBeNull();
    expect(languageFor('config.yaml')).toBeNull();
    expect(languageFor('Main.java')).toBeNull();
  });
});
