import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ActivityRail } from './activity-rail.js';

/**
 * UI polish (navigation rail label clipping): `leading-none` (line-height: 1) left no vertical
 * buffer for a glyph's descender, which only became visible once "Suggest" (Sprint F1) added the
 * rail's first label with a descender (the two "g"s) — it rendered clipped at the bottom, worse
 * under Windows' fractional display scaling (125%/150%) where sub-pixel rounding shaves into an
 * already-exact-fit line box.
 *
 * jsdom does not lay out real glyph metrics, so this cannot pixel-verify the clip is gone; it pins
 * the two things that are checkable and would regress the fix if reverted: the tight, zero-buffer
 * line-height class must never come back, and the rail's layout (item count, order, icon/label
 * spacing) must stay exactly as it was — this is a label fix, not a redesign.
 */
describe('ActivityRail', () => {
  it('renders every item, in the original order, with unclipped-safe label styling', () => {
    render(<ActivityRail />);
    const nav = screen.getByRole('navigation', { name: 'Primary' });
    const buttons = nav.querySelectorAll('button');
    expect([...buttons].map((b) => b.getAttribute('aria-label'))).toEqual([
      'Files',
      'Search',
      'Problems',
      'Source',
      'History',
      'Packages',
      'Terminal',
      'Preview',
      'Suggest',
      'Fixora Upgrade',
      'Settings',
      'Sign in',
    ]);
  });

  it('gives every label room for descenders instead of a zero-buffer line-height', () => {
    render(<ActivityRail />);
    // "Suggest" is the one label with descenders (the two "g"s) — the label that made the clip
    // visible in the first place.
    const label = screen.getByText('Suggest');
    expect(label.className).not.toMatch(/\bleading-none\b/);
    expect(label.className).toMatch(/\bleading-tight\b/);
  });

  it('keeps equal icon-to-label spacing (gap-1.5) and centred, single-line labels', () => {
    render(<ActivityRail />);
    const button = screen.getByRole('button', { name: 'Suggest' });
    expect(button.className).toMatch(/\bgap-1\.5\b/);
    const label = screen.getByText('Suggest');
    expect(label.className).toMatch(/\btext-center\b/);
    expect(label.className).toMatch(/\btruncate\b/); // still single-line with ellipsis overflow
  });
});
