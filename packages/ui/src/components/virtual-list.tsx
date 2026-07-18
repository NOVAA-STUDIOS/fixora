import { useVirtualizer } from '@tanstack/react-virtual';
import { useRef, type ReactNode } from 'react';

import { cn } from '../lib/cn.js';

export type VirtualListProps<T> = {
  items: readonly T[];
  /** Rendered per visible row. `index` is the item's position in `items`. */
  renderItem: (item: T, index: number) => ReactNode;
  /** Fixed row height in px. Defaults to the density row-height token resolved to a number. */
  estimateRowHeight?: number;
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
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: `${String(row.size)}px`,
                overflow: 'hidden',
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
