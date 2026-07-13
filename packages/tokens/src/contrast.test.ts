import { describe, expect, it } from 'vitest';

import { contrastRatio, parseHex, relativeLuminance } from './contrast.js';
import { auditAllThemes } from './requirements.js';

describe('contrastRatio', () => {
  it('matches the WCAG reference values', () => {
    // The two anchors every implementation must agree on.
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 5);
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5);

    // Published reference: #767676 is the lightest grey that still clears 4.5:1 on white.
    expect(contrastRatio('#767676', '#ffffff')).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio('#777777', '#ffffff')).toBeLessThan(4.5);
  });

  it('is order-independent', () => {
    expect(contrastRatio('#7c3aed', '#0b0a0f')).toBeCloseTo(
      contrastRatio('#0b0a0f', '#7c3aed'),
      10,
    );
  });
});

describe('relativeLuminance', () => {
  it('anchors at 0 and 1', () => {
    expect(relativeLuminance('#000000')).toBeCloseTo(0, 10);
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 10);
  });
});

describe('parseHex', () => {
  it('rejects anything that is not a 6-digit hex', () => {
    // A malformed token must be loud. Silently coercing it is how an unchecked colour
    // reaches the palette without the gate ever seeing it.
    expect(() => parseHex('#fff')).toThrow();
    expect(() => parseHex('rebeccapurple')).toThrow();
    expect(() => parseHex('7c3aed')).toThrow();
  });
});

describe('the palette', () => {
  it('has no contrast violation in either theme', () => {
    const failures = auditAllThemes().filter((r) => !r.passed);
    expect(
      failures.map(
        (f) => `${f.theme}: ${f.id} = ${f.ratio.toFixed(2)}:1 (needs ${String(f.minRatio)})`,
      ),
    ).toEqual([]);
  });

  it('actually checks something', () => {
    // Guards against the failure mode where the audit silently returns [] and the gate
    // reports a triumphant green.
    expect(auditAllThemes().length).toBeGreaterThan(40);
  });
});
