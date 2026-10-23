import { describe, expect, it } from 'vitest';

import { activeFallbackPath, indexMentionFiles, insertMention, normalizeMentionPath, parseMentionPaths, rankMentionFiles, searchMentionFiles } from './mention-context.js';

describe('Zappr mention context helpers', () => {
  it('ranks exact filename and prefix matches above loose path matches, without duplicates', () => {
    expect(rankMentionFiles(['src/foo.ts', 'src/foo.ts.test', 'docs/my-foo.ts', 'src/foo.ts'], 'foo.ts'))
      .toEqual(['src/foo.ts', 'src/foo.ts.test', 'docs/my-foo.ts']);
  });

  it('keeps indexed mention ranking stable and rebuilds cleanly when workspace files change', () => {
    const index = indexMentionFiles(['src/foo.ts', 'src/foo.ts.test', 'docs/my-foo.ts', 'src/foo.ts']);
    expect(searchMentionFiles(index, 'foo.ts')).toEqual(['src/foo.ts', 'src/foo.ts.test', 'docs/my-foo.ts']);
    expect(searchMentionFiles(indexMentionFiles(['new/foo.ts']), 'foo.ts')).toEqual(['new/foo.ts']);
  });

  it('inserts a relative mention once and leaves a clean space boundary', () => {
    expect(insertMention('please inspect @fo after this', 15, 18, 'src/foo.ts'))
      .toEqual({ text: 'please inspect @src/foo.ts after this', cursor: 26 });
  });

  it('normalizes safe relative paths and rejects absolute or escaping paths', () => {
    expect(normalizeMentionPath('./src/app.ts')).toBe('src/app.ts');
    expect(normalizeMentionPath('../secret')).toBeNull();
    expect(normalizeMentionPath('C:/secret')).toBeNull();
    expect(normalizeMentionPath('/secret')).toBeNull();
  });

  it('extracts mentions in order and de-duplicates repeats', () => {
    expect(parseMentionPaths('Use @src/app.ts and @tests/app.test.ts then @src/app.ts'))
      .toEqual(['src/app.ts', 'tests/app.test.ts']);
    expect(parseMentionPaths('Use @../outside.ts')).toEqual([]);
  });

  it('uses active file only when selected and mentioned contexts do not already cover it', () => {
    expect(activeFallbackPath('src/app.ts', null, [])).toBe('src/app.ts');
    expect(activeFallbackPath('src/app.ts', 'src/app.ts', [])).toBeNull();
    expect(activeFallbackPath('src/app.ts', null, ['src/app.ts'])).toBeNull();
    expect(activeFallbackPath('C:/private/app.ts', null, [])).toBeNull();
  });
});
