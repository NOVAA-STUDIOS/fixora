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
   * Advanced Repair is a STANDALONE engine, not a bigger version of `ai-file` — it targets a
   * root-cause-computed range, never the whole file blindly, and it can land on a different
   * location than the one selected. Its own warning must say so, distinctly from ai-file's.
   */
  it('Advanced Repair warns that it may retarget, and never claims to touch the whole file', () => {
    const warning = repairModeInfo('advanced').warning ?? '';
    expect(warning).toMatch(/different location|root cause/i);
    expect(warning).toMatch(/verified/i);
    // Reassures it will NOT blindly touch the whole file — must never instead CLAIM to replace it.
    expect(warning.toLowerCase()).not.toContain('replaces the whole file');
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
