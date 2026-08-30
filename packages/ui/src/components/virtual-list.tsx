import { useVirtualizer } from '@tanstack/react-virtual';
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

import { cn } from '../lib/cn.js';

export type VirtualListProps<T> = {
  items: readonly T[];
  /** Rendered per visible row. `index` is the item's position in `items`. */
  renderItem: (item: T, index: number) => ReactNode;
  /** Row height in px. With `dynamicRowHeight` this is only the first-paint estimate. */
  estimateRowHeight?: number;
  /**
   * Measure each row instead of trusting `estimateRowHeight`.
   *
   * A fixed stride is right for a uniform list (the file tree: one line, one height, tens of
   * thousands of rows). It is wrong for a list whose rows contain wrapping text, because the stride
   * has to be guessed for the *worst* case and the guess breaks the moment anything changes the
   * cast: compact density, OS text scaling at 125/150%, a long rule id. The row then either clips
   * its own content or overlaps the row below. Measuring costs a `ResizeObserver` per visible row —
   * a screenful, not a repo — and is the only thing that stays correct across all of those.
   */
  dynamicRowHeight?: boolean;
  /** Whether a row is the selected one. Rows are `role="option"`, so a listbox that has a selection
   * must say which — a hardcoded `aria-selected={false}` tells a screen reader nothing is selected. */
  isSelected?: (item: T, index: number) => boolean;
  /** A stable key per row — never the index, or selection jumps when the list reorders. */
  getKey: (item: T, index: number) => string;
  className?: string;
  /** Accessible name for the scroll region (e.g. "File tree", "Findings"). */
  label: string;
  overscan?: number;
  /**
   * Called when the user activates the current keyboard-focused row (Enter/Space) — never on a
   * plain click, which is `renderItem`'s own responsibility to wire (beta audit A2, File tree
   * keyboard-navigation finding). Omit to leave the list read-only from the keyboard beyond moving
   * the active row.
   */
  onActivate?: (item: T, index: number) => void;
};

/**
 * A windowed list. "Never hold all files in memory" / "virtualise everything lists can be long"
 * (TDD §10, §7): the file tree (M2) and findings panel (M3) can be tens of thousands of rows, and
 * rendering them all is the difference between a 2-second repo open and a frozen one. This renders
 * only the visible window plus a small overscan.
 *
 * It is the presentational primitive only — it knows nothing of files or findings. The feature
 * slice supplies `items`, `renderItem` and a stable `getKey`.
 *
 * **Keyboard (beta audit A2):** the container carries `role="listbox"`/`role="option"` rows, which
 * is a promise to assistive tech that arrow keys move a roving selection — a promise the component
 * did not keep until now. It does the standard composite-widget thing: one roving "active" index
 * (not real DOM focus, which stays on the container), moved by Arrow Up/Down/Home/End, announced
 * via `aria-activedescendant`, and scrolled into view on every move so keyboard navigation works
 * past whatever the virtualizer currently has rendered. Enter/Space activates the active row via
 * `onActivate`. Consumers must not make individual rows tab stops (leave them `tabIndex={-1}`) —
 * the container is the single stop, exactly as a native `<select>` behaves.
 */
export function VirtualList<T>({
  items,
  renderItem,
  estimateRowHeight = 28,
  dynamicRowHeight = false,
  isSelected,
  getKey,
  className,
  label,
  overscan = 12,
  onActivate,
}: VirtualListProps<T>): React.JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null);
  const baseId = useId();
  const [activeIndex, setActiveIndex] = useState(0);
  // Clamped, not reset — collapsing a directory or a list shrinking should not throw the active
  // row back to the top if the previously-active index is still in range.
  const clampedActive = items.length === 0 ? -1 : Math.min(activeIndex, items.length - 1);

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => estimateRowHeight,
    overscan,
  });

  // Re-measure when the estimate changes (a density switch) or the list itself changes size: the
  // cached measurements describe the old metrics/old items, so keeping them would leave gaps or
  // overlaps until every row happened to re-render on its own.
  useEffect(() => {
    virtualizer.measure();
  }, [virtualizer, estimateRowHeight, items.length]);

  const moveActive = (next: number): void => {
    if (items.length === 0) return;
    const clamped = Math.max(0, Math.min(next, items.length - 1));
    setActiveIndex(clamped);
    virtualizer.scrollToIndex(clamped, { align: 'auto' });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (items.length === 0) return;
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        moveActive(clampedActive + 1);
        return;
      case 'ArrowUp':
        event.preventDefault();
        moveActive(clampedActive - 1);
        return;
      case 'Home':
        event.preventDefault();
        moveActive(0);
        return;
      case 'End':
        event.preventDefault();
        moveActive(items.length - 1);
        return;
      case 'Enter':
      case ' ': {
        if (clampedActive === -1) return;
        const item = items[clampedActive];
        if (item === undefined) return;
        event.preventDefault();
        onActivate?.(item, clampedActive);
      }
    }
  };

  return (
    <div
      ref={scrollRef}
      role="listbox"
      aria-label={label}
      tabIndex={0}
      onKeyDown={onKeyDown}
      aria-activedescendant={clampedActive === -1 ? undefined : `${baseId}-${String(clampedActive)}`}
      className={cn(
        'group h-full overflow-auto outline-none',
        'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus-ring focus-visible:outline',
        className,
      )}
    >
      <div style={{ height: `${String(virtualizer.getTotalSize())}px`, position: 'relative' }}>
        {virtualizer.getVirtualItems().map((row) => {
          const item = items[row.index];
          if (item === undefined) return null;
          return (
            <div
              key={getKey(item, row.index)}
              id={`${baseId}-${String(row.index)}`}
              role="option"
              aria-selected={isSelected?.(item, row.index) ?? false}
              data-index={row.index}
              // Mousing over/down on a row moves the roving active index to match, so keyboard
              // navigation resumes from wherever the pointer last landed rather than the top.
              onMouseDown={() => {
                setActiveIndex(row.index);
              }}
              // `data-index` is not decorative here: the virtualizer reads it back off the measured
              // element to know which row it just measured.
              ref={dynamicRowHeight ? virtualizer.measureElement : undefined}
              className={cn(
                // The roving-active indicator — distinct from `isSelected`'s own styling (e.g. the
                // file tree's solid `bg-active` for the open file) — and shown only while the list
                // itself actually has focus, via `group-focus`, so it doesn't linger once focus
                // moves elsewhere.
                row.index === clampedActive &&
                  'group-focus:ring-1 group-focus:ring-inset group-focus:ring-focus-ring',
              )}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                // A measured row must be free to be as tall as its content; pinning the height (and
                // clipping the overflow) would just feed the estimate back in as the measurement.
                ...(dynamicRowHeight
                  ? {}
                  : { height: `${String(row.size)}px`, overflow: 'hidden' }),
                transform: `translateY(${String(row.start)}px)`,
              }}
            >
              {renderItem(item, row.index)}
            </div>
          );
        })}
      </div>
    </div>
  );
}
