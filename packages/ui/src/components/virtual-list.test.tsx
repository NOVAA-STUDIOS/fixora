import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

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

/**
 * Beta audit A2 (File tree keyboard-navigation finding): the container advertises `listbox`/
 * `option` roles — a promise to assistive tech that arrow keys move a roving selection. These
 * tests hold it to that promise: Arrow Up/Down/Home/End move `aria-activedescendant`, and
 * Enter/Space activate whichever row is currently active.
 */
describe('VirtualList keyboard navigation', () => {
  const small = Array.from({ length: 5 }, (_, i) => ({ id: `row-${String(i)}`, label: `Row ${String(i)}` }));

  // jsdom does not compute real layout, so the virtualizer may not mount the active row's actual
  // DOM node (its "visible window" math depends on a real clientHeight) — the same limitation the
  // windowing test above already works around. The active index is parsed from the id itself
  // rather than looked up via `getElementById`, since the id format (`${baseId}-${index}`) is
  // exactly what `aria-activedescendant` is asserting either way.
  function activeIndex(list: HTMLElement): number {
    const id = list.getAttribute('aria-activedescendant');
    expect(id).not.toBeNull();
    const match = /-(\d+)$/.exec(id ?? '');
    expect(match).not.toBeNull();
    return Number(match?.[1]);
  }

  it('starts with the first row active', () => {
    render(
      <VirtualList
        label="Rows"
        items={small}
        getKey={(item) => item.id}
        renderItem={(item) => <span>{item.label}</span>}
      />,
    );
    expect(activeIndex(screen.getByRole('listbox'))).toBe(0);
  });

  it('ArrowDown/ArrowUp move the active row by one, clamped to the list bounds', async () => {
    render(
      <VirtualList
        label="Rows"
        items={small}
        getKey={(item) => item.id}
        renderItem={(item) => <span>{item.label}</span>}
      />,
    );
    const list = screen.getByRole('listbox');
    list.focus();

    await userEvent.keyboard('{ArrowDown}');
    expect(activeIndex(list)).toBe(1);
    await userEvent.keyboard('{ArrowDown}');
    expect(activeIndex(list)).toBe(2);
    await userEvent.keyboard('{ArrowUp}');
    expect(activeIndex(list)).toBe(1);

    // Clamped: cannot move above the first row.
    await userEvent.keyboard('{ArrowUp}{ArrowUp}{ArrowUp}');
    expect(activeIndex(list)).toBe(0);
  });

  it('Home/End jump to the first/last row', async () => {
    render(
      <VirtualList
        label="Rows"
        items={small}
        getKey={(item) => item.id}
        renderItem={(item) => <span>{item.label}</span>}
      />,
    );
    const list = screen.getByRole('listbox');
    list.focus();

    await userEvent.keyboard('{End}');
    expect(activeIndex(list)).toBe(4);
    await userEvent.keyboard('{Home}');
    expect(activeIndex(list)).toBe(0);
  });

  it('cannot move past the last row', async () => {
    render(
      <VirtualList
        label="Rows"
        items={small}
        getKey={(item) => item.id}
        renderItem={(item) => <span>{item.label}</span>}
      />,
    );
    const list = screen.getByRole('listbox');
    list.focus();
    await userEvent.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}');
    expect(activeIndex(list)).toBe(4);
  });

  it('Enter and Space activate the currently active row via onActivate', async () => {
    const onActivate = vi.fn();
    render(
      <VirtualList
        label="Rows"
        items={small}
        getKey={(item) => item.id}
        renderItem={(item) => <span>{item.label}</span>}
        onActivate={onActivate}
      />,
    );
    const list = screen.getByRole('listbox');
    list.focus();

    await userEvent.keyboard('{ArrowDown}{ArrowDown}');
    await userEvent.keyboard('{Enter}');
    expect(onActivate).toHaveBeenCalledWith(small[2], 2);

    await userEvent.keyboard(' ');
    expect(onActivate).toHaveBeenCalledWith(small[2], 2);
    expect(onActivate).toHaveBeenCalledTimes(2);
  });

  it('does nothing on an empty list rather than throwing', async () => {
    render(<VirtualList label="Rows" items={[]} getKey={(item: never) => item} renderItem={() => null} />);
    const list = screen.getByRole('listbox');
    list.focus();
    await userEvent.keyboard('{ArrowDown}{Enter}{End}{Home}');
    expect(list.getAttribute('aria-activedescendant')).toBeNull();
  });
});
