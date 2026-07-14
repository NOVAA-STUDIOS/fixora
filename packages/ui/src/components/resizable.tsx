import {
  Group,
  Panel,
  Separator,
  type GroupProps,
  type SeparatorProps,
} from 'react-resizable-panels';

import { cn } from '../lib/cn.js';

/**
 * The resizable-panel primitive behind the three-pane shell (Design Review §5). Built on
 * `react-resizable-panels` v4, which gives us the parts that are painful to get right: a
 * **keyboard-operable** separator (arrow keys resize — an acceptance criterion, since the shell
 * must be operable with the keyboard alone), and a `defaultLayout`/`onLayoutChanged` pair the
 * shell uses to persist pane sizes across restarts.
 *
 * Layout persistence lives with the consumer (the shell reads/writes storage via
 * `onLayoutChanged` + `defaultLayout`), not in a second copy inside this primitive — ADR-015:
 * one owner per fact.
 */
export function PanelGroupRoot({ className, ...props }: GroupProps): React.JSX.Element {
  return <Group className={cn('h-full w-full', className)} {...props} />;
}

export const ResizablePanel = Panel;

export function ResizeHandle({ className, ...props }: SeparatorProps): React.JSX.Element {
  return (
    <Separator
      className={cn(
        // A thin line that brightens on hover/drag/focus. The focus ring is essential — the
        // separator is keyboard-reachable and a keyboard user must see where they are. State is
        // exposed by the library via the `data-separator` attribute set while dragging.
        'relative bg-border-subtle outline-none',
        'transition-colors duration-(--fx-motion-duration-fast) ease-(--ease-entrance)',
        'hover:bg-accent-border data-[separator]:bg-accent',
        'focus-visible:bg-accent focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus-ring focus-visible:outline',
        className,
      )}
      {...props}
    />
  );
}
