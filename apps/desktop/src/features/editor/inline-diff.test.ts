import { describe, expect, it } from 'vitest';

import { computeHunks, describeHunks } from './inline-diff.js';

/**
 * Hunk computation for the inline review surface.
 *
 * This is the only logic the editor-first repair experience adds. It decides where the editor draws
 * "this line is being replaced" and what the Next/Previous buttons step between — nothing else. It
 * has no say in whether a repair is correct or appliable; the verifier and the Apply gate are
 * untouched and remain the only authorities on that.
 */
describe('computeHunks', () => {
  it('reports a single changed line as one hunk, in file coordinates', () => {
    const hunks = computeHunks('const a = 1;', 'const a = 2;', 10);
    expect(hunks).toEqual([{ startLine: 10, removedCount: 1, added: ['const a = 2;'] }]);
  });

  it('returns nothing when the replacement is identical', () => {
    expect(computeHunks('a\nb\nc', 'a\nb\nc', 1)).toEqual([]);
  });

  it('groups a contiguous run of changes into ONE hunk, not one per line', () => {
    // A reindented or restructured block is a single edit to a reader. Emitting a hunk per line
    // would turn Next/Previous into a line-by-line crawl.
    const hunks = computeHunks('a\nX\nY\nd', 'a\nP\nQ\nd', 1);
    expect(hunks).toHaveLength(1);
    expect(hunks[0]?.startLine).toBe(2);
    expect(hunks[0]?.removedCount).toBe(2);
    expect(hunks[0]?.added).toEqual(['P', 'Q']);
  });

  it('separates changes that have untouched code between them', () => {
    const hunks = computeHunks('a\nX\nc\nY\ne', 'a\nP\nc\nQ\ne', 1);
    expect(hunks).toHaveLength(2);
    expect(hunks[0]?.startLine).toBe(2);
    expect(hunks[1]?.startLine).toBe(4);
  });

  it('handles a pure insertion — nothing removed', () => {
    // The production case: the prerequisite `await` fix adds a guard without deleting anything.
    const hunks = computeHunks('a\nb', 'a\nNEW\nb', 1);
    expect(hunks).toHaveLength(1);
    expect(hunks[0]?.removedCount).toBe(0);
    expect(hunks[0]?.added).toEqual(['NEW']);
  });

  it('handles a pure deletion — nothing added', () => {
    const hunks = computeHunks('a\ngone\nb', 'a\nb', 1);
    expect(hunks).toHaveLength(1);
    expect(hunks[0]?.removedCount).toBe(1);
    expect(hunks[0]?.added).toEqual([]);
  });

  it('offsets every hunk by the slice base line, so hunks address the real document', () => {
    // The patch target starts at line 26; a change to the slice's third line is document line 28 —
    // which is exactly the reported defect in the api.ts case.
    const hunks = computeHunks('a\nb\nc', 'a\nb\nCHANGED', 26);
    expect(hunks[0]?.startLine).toBe(28);
  });

  it('handles the replacement being longer AND shorter in different places', () => {
    const hunks = computeHunks('keep\nold1\nold2\nkeep2\nx', 'keep\nnew1\nkeep2\nx\nextra', 1);
    expect(hunks.length).toBeGreaterThanOrEqual(2);
    // Every hunk stays within the document and carries a sane shape.
    for (const h of hunks) {
      expect(h.startLine).toBeGreaterThanOrEqual(1);
      expect(h.removedCount).toBeGreaterThanOrEqual(0);
    }
  });

  it('is stable for CRLF input — line endings are not a change', () => {
    expect(computeHunks('a\r\nb\r\nc', 'a\nb\nc', 1)).toEqual([]);
  });

  it('treats an empty replacement as deleting the whole slice', () => {
    const hunks = computeHunks('a\nb', '', 5);
    expect(hunks).toHaveLength(1);
    expect(hunks[0]?.startLine).toBe(5);
  });
});

describe('describeHunks', () => {
  it('summarises counts for the widget header', () => {
    const hunks = computeHunks('a\nX\nc', 'a\nP\nQ\nc', 1);
    expect(describeHunks(hunks)).toMatch(/1 edit/);
    expect(describeHunks(hunks)).toContain('+2');
  });

  it('says so plainly when there is nothing to review', () => {
    expect(describeHunks([])).toBe('No changes');
  });

  it('pluralises', () => {
    const two = computeHunks('a\nX\nc\nY\ne', 'a\nP\nc\nQ\ne', 1);
    expect(describeHunks(two)).toMatch(/2 edits/);
  });
});
