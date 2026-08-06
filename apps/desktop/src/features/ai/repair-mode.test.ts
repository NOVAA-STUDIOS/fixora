import { describe, expect, it } from 'vitest';

import { DEFAULT_REPAIR_MODE, REPAIR_MODES, repairModeInfo } from './repair-mode.js';

/**
 * ISSUE 8: the repair modes.
 *
 * The ladder is ordered by blast radius, and that ordering IS the safety model — so the default must
 * stay the smallest, and the widest must be marked advanced and carry a warning that says plainly
 * what it replaces.
 */
describe('repair modes', () => {
  it('defaults to the smallest patch', () => {
    expect(DEFAULT_REPAIR_MODE).toBe('finding');
    expect(repairModeInfo(undefined).mode).toBe('finding');
  });

  it('offers exactly the four modes, ordered by blast radius', () => {
    expect(REPAIR_MODES.map((m) => m.mode)).toEqual([
      'finding',
      'related-scope',
      'ai-file',
      'advanced',
    ]);
  });

  it('ai-file and advanced are both marked advanced, and named as such', () => {
    expect(REPAIR_MODES.filter((m) => m.advanced).map((m) => m.mode)).toEqual([
      'ai-file',
      'advanced',
    ]);
    expect(repairModeInfo('ai-file').label).toBe('AI File Repair (Advanced)');
    expect(repairModeInfo('advanced').label).toBe('Advanced Repair');
  });

  /**
   * Advanced Repair now shares `ai-file`'s splice range — the whole file — because it collects
   * every problem in the file into one request rather than fixing them one at a time. What
   * distinguishes it is no longer a smaller blast radius (it isn't one — the warning must say the
   * same "whole file, largest change" thing ai-file's does), but the single combined request and the
   * capped single retry, both described in `description`, not in `warning`.
   */
  it('Advanced Repair warns, same as ai-file, that it replaces the whole file', () => {
    const warning = repairModeInfo('advanced').warning ?? '';
    expect(warning).toMatch(/whole file/i);
    expect(warning).toMatch(/verified/i);
  });

  it('Advanced Repair’s description is what actually distinguishes it: one combined request, one retry', () => {
    const description = repairModeInfo('advanced').description;
    expect(description).toMatch(/together|one request/i);
    expect(description).toMatch(/retr(y|ies)/i);
  });

  it('the advanced mode warns, in plain words, that it replaces the whole file', () => {
    const warning = repairModeInfo('ai-file').warning ?? '';
    expect(warning).toMatch(/whole file/i);
    expect(warning).toMatch(/verified/i); // it is still gated
    expect(warning).toMatch(/nothing is written until you press apply/i);
  });

  it('the two safe modes carry no warning — a warning on everything warns about nothing', () => {
    expect(repairModeInfo('finding').warning).toBeUndefined();
    expect(repairModeInfo('related-scope').warning).toBeUndefined();
  });

  it('every mode states the scope it covers, for the panel banner', () => {
    for (const m of REPAIR_MODES) {
      expect(m.scopeLabel.length).toBeGreaterThan(5);
      expect(m.description.length).toBeGreaterThan(20);
    }
  });
});
