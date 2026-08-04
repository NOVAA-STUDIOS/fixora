import { describe, expect, it } from 'vitest';

import { comfortable, compact, densities, type DensityMetrics } from './density.js';

/**
 * Density has to be a difference the user can SEE.
 *
 * The toggle existed and did almost nothing to the surfaces that matter: control heights and the
 * virtualised row stride moved, but a problem card — a stack of title, location and actions — kept
 * comfortable padding at every density, because the card's spacing was hardcoded in the component
 * rather than taken from a token. The switch visibly changed the chrome around the list and left the
 * list itself alone.
 *
 * These pin the property that fixes it: every metric is strictly tighter at compact, and the card
 * spacing in particular lands in the band that reads as a real density change without collapsing the
 * rows into a wall of text.
 */
const REM = /^(\d*\.?\d+)rem$/;

function rem(value: string): number {
  const match = REM.exec(value);
  if (match === null) throw new Error(`not a rem value: ${value}`);
  return Number.parseFloat(match[1] as string);
}

/** The non-content height of a three-part card: two paddings plus the two gaps between its parts. */
function cardSpacing(d: DensityMetrics): number {
  return rem(d.cardPaddingY) * 2 + rem(d.cardGap) * 2;
}

describe('density metrics', () => {
  it('expresses every metric in rem, so density scales with the user’s root font size', () => {
    for (const metrics of Object.values(densities)) {
      for (const [key, value] of Object.entries(metrics)) {
        expect(value, key).toMatch(REM);
      }
    }
  });

  it('defines the same metrics for both densities — no half-implemented mode', () => {
    expect(Object.keys(compact).sort()).toEqual(Object.keys(comfortable).sort());
  });

  it('is strictly tighter at compact for every single metric', () => {
    // A metric that forgot to shrink is exactly how the toggle became half-effective before.
    for (const key of Object.keys(comfortable) as (keyof DensityMetrics)[]) {
      expect(rem(compact[key]), key).toBeLessThan(rem(comfortable[key]));
    }
  });
});

describe('card density — the difference the Problems panel shows', () => {
  it('reduces card spacing by 25–35%, the band that reads as a real change', () => {
    const reduction =
      (cardSpacing(comfortable) - cardSpacing(compact)) / cardSpacing(comfortable);
    expect(reduction).toBeGreaterThanOrEqual(0.25);
    expect(reduction).toBeLessThanOrEqual(0.35);
  });

  it('keeps comfortable genuinely roomy rather than compact-with-a-different-name', () => {
    // If comfortable is not comfortable, the toggle has one useful position instead of two.
    expect(cardSpacing(comfortable)).toBeGreaterThanOrEqual(1.5);
  });

  it('never collapses a card to zero internal separation at compact', () => {
    // Rows must still read as separate cards; past roughly a third the list becomes a wall of text.
    expect(rem(compact.cardGap)).toBeGreaterThan(0);
    expect(rem(compact.cardPaddingY)).toBeGreaterThan(0);
  });

  it('trims the status bar at compact without hiding it', () => {
    expect(rem(compact.statusBarHeight)).toBeLessThan(rem(comfortable.statusBarHeight));
    // Still tall enough to hold its own text — a status bar shorter than its line-height clips.
    expect(rem(compact.statusBarHeight)).toBeGreaterThanOrEqual(1.25);
  });

  it('tightens sidebar spacing at compact', () => {
    expect(rem(compact.sidebarGap)).toBeLessThan(rem(comfortable.sidebarGap));
  });
});
