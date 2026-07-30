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

  it('offers exactly the three modes, ordered by blast radius', () => {
    expect(REPAIR_MODES.map((m) => m.mode)).toEqual(['finding', 'related-scope', 'ai-file']);
  });

  it('only the whole-file mode is advanced, and it is named as such', () => {
    expect(REPAIR_MODES.filter((m) => m.advanced).map((m) => m.mode)).toEqual(['ai-file']);
    expect(repairModeInfo('ai-file').label).toBe('AI File Repair (Advanced)');
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
