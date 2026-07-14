import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { VirtualList } from './virtual-list.js';

/**
 * VirtualList windows long lists so a 10k-file tree opens in under 2s (TDD §10). The *windowing*
 * (rendering only the visible rows) needs real layout, which jsdom does not compute — that perf
 * property is verified in the real app, and is an M2 acceptance criterion. What jsdom *can* prove
 * is that the virtualizer is wired for the full count: the scroll spacer is sized for all items
 * (count × row height), which is what makes the scrollbar correct without holding every row.
 */
describe('VirtualList', () => {
  const items = Array.from({ length: 10_000 }, (_, i) => ({
    id: `row-${String(i)}`,
    label: `Row ${String(i)}`,
  }));

  it('sizes its scroll spacer for all items without rendering them all', () => {
    const { container } = render(
      <VirtualList
        label="Rows"
        items={items}
        estimateRowHeight={28}
        getKey={(item) => item.id}
        renderItem={(item) => <span>{item.label}</span>}
      />,
    );
    // The inner spacer height = 10,000 × 28px, so the scrollbar is correct for the whole list…
    const spacer = container.querySelector('[style*="position: relative"]');
    expect(spacer).toHaveStyle({ height: '280000px' });
    // …while the actual rendered rows are a tiny window, never all 10,000.
    expect(screen.queryAllByRole('option').length).toBeLessThan(200);
  });

  it('exposes an accessible, focusable listbox', () => {
    render(
      <VirtualList
        label="Findings"
        items={items}
        getKey={(item) => item.id}
        renderItem={(item) => <span>{item.label}</span>}
      />,
    );
    const list = screen.getByRole('listbox', { name: 'Findings' });
    expect(list).toHaveAttribute('tabindex', '0');
  });
});
