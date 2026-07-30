import { describe, expect, it } from 'vitest';

import { IMPACT_DOT, IMPACT_LABEL, repairImpact } from './repair-impact.js';

/**
 * Impact is DERIVED from how much code actually moves, not declared per mode.
 *
 * Mode alone is not impact: a `finding` repair on a 200-line component changes far more than a
 * `related-scope` one on a three-line helper. The one exception is whole-file mode, which is always
 * High because replacing the file is the largest edit the app can make however short the file is.
 */
describe('repairImpact', () => {
  it('a small patch is Low, whatever the mode', () => {
    expect(repairImpact('finding', 1).level).toBe('low');
    expect(repairImpact('finding', 10).level).toBe('low');
    expect(repairImpact('related-scope', 4).level).toBe('low');
  });

  it('a mid-sized patch is Medium', () => {
    expect(repairImpact('finding', 11).level).toBe('medium');
    expect(repairImpact('related-scope', 50).level).toBe('medium');
  });

  it('a large patch is High even in the default mode — size, not mode, decides', () => {
    expect(repairImpact('finding', 51).level).toBe('high');
    expect(repairImpact('related-scope', 400).level).toBe('high');
  });

  it('whole-file mode is ALWAYS High, even for a tiny file', () => {
    // Replacing the file is the largest edit the app can make regardless of its length.
    expect(repairImpact('ai-file', 3).level).toBe('high');
    expect(repairImpact('ai-file', 3).summary).toMatch(/whole file/i);
  });

  it('an absent mode is treated as the default, not as unknown', () => {
    expect(repairImpact(undefined, 2).level).toBe('low');
  });

  it('the summary always states the measurement the rating came from', () => {
    expect(repairImpact('finding', 1).summary).toBe('1 line replaced');
    expect(repairImpact('finding', 7).summary).toBe('7 lines replaced');
    expect(repairImpact('ai-file', 120).summary).toContain('120');
  });

  it('every level has a label and a distinct colour', () => {
    const dots = new Set(Object.values(IMPACT_DOT));
    expect(dots.size).toBe(3); // green / amber / red must not collapse
    for (const level of ['low', 'medium', 'high'] as const) {
      expect(IMPACT_LABEL[level].length).toBeGreaterThan(0);
    }
  });
});
