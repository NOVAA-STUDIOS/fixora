import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Scroll containers that hold visually-hidden text must establish a positioning context.
 *
 * Tailwind's `sr-only` is `position: absolute` with no offsets, so it resolves against the nearest
 * POSITIONED ancestor. With none, that is the initial containing block — and the element then sits
 * at document coordinates, escaping every `overflow` on the way up.
 *
 * Not theoretical: six per-provider key labels in Settings landed at document Y up to 1504px, giving
 * the whole window 736px of empty scroll below the UI — `window.scrollTo(0, 9999)` moved the entire
 * app off-screen. Measured in the running app, fixed with `relative`, re-measured at
 * `scrollHeight === clientHeight`.
 *
 * Asserted on source text rather than on layout because jsdom performs none: every box is 0x0 there,
 * so the geometry that actually broke is exactly what a rendering test cannot see. The invariant
 * worth locking is structural — a scroller whose subtree contains `sr-only` also carries `relative`
 * — and that is legible in the markup.
 */
const FEATURES = join(process.cwd(), 'src', 'features');

const SCROLLERS: readonly { file: string; marker: string }[] = [
  // Renders ProviderManager, whose key fields each carry an sr-only label.
  {
    file: 'settings/settings-panel.tsx',
    marker: 'min-h-0 flex-1 overflow-y-auto overflow-x-hidden',
  },
  // Renders the provider error card, one sr-only per status check.
  { file: 'ai/ai-panel.tsx', marker: 'min-h-0 flex-1 overflow-y-auto p-3' },
];

describe('scroll containers contain their absolutely-positioned children', () => {
  for (const { file, marker } of SCROLLERS) {
    it(`${file} keeps its scroller positioned`, () => {
      const source = readFileSync(join(FEATURES, file), 'utf8');
      const line = source.split('\n').find((text) => text.includes(marker));
      expect(line, `no scroller matching "${marker}"`).toBeDefined();
      expect(line).toContain('relative');
    });
  }

  it('the provider key label is still sr-only — the condition this guards', () => {
    // If this stops being true, the `relative` above is merely harmless rather than load-bearing,
    // and whoever reads that class deserves to know which it is.
    const source = readFileSync(join(FEATURES, 'settings/provider-manager.tsx'), 'utf8');
    expect(source).toContain('className="sr-only"');
  });
});
