import { useVirtualizer } from '@tanstack/react-virtual';
import { useEffect, useRef, type ReactNode } from 'react';

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
};

/**
 * A windowed list. "Never hold all files in memory" / "virtualise everything lists can be long"
 * (TDD §10, §7): the file tree (M2) and findings panel (M3) can be tens of thousands of rows, and
 * rendering them all is the difference between a 2-second repo open and a frozen one. This renders
 * only the visible window plus a small overscan.
 *
 * It is the presentational primitive only — it knows nothing of files or findings. The feature
 * slice supplies `items`, `renderItem` and a stable `getKey`.
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
}: VirtualListProps<T>): React.JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => estimateRowHeight,
    overscan,
  });

  // Re-measure when the estimate changes (a density switch): the cached measurements describe the
  // old metrics, so keeping them would leave gaps or overlaps until every row happened to re-render.
  useEffect(() => {
    virtualizer.measure();
  }, [virtualizer, estimateRowHeight]);

  return (
    <div
      ref={scrollRef}
      role="listbox"
      aria-label={label}
      tabIndex={0}
      className={cn(
        'h-full overflow-auto outline-none',
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
              role="option"
              aria-selected={isSelected?.(item, row.index) ?? false}
              data-index={row.index}
              // `data-index` is not decorative here: the virtualizer reads it back off the measured
              // element to know which row it just measured.
              ref={dynamicRowHeight ? virtualizer.measureElement : undefined}
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
