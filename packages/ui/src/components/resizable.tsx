import {
  Group,
  Panel,
  Separator,
  usePanelRef,
  type GroupProps,
  type PanelImperativeHandle,
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
export { usePanelRef, type PanelImperativeHandle };

export function ResizeHandle({ className, ...props }: SeparatorProps): React.JSX.Element {
  return (
    <Separator
      className={cn(
        // The library sizes the separator with `flex-basis: auto` and renders no children, so
        // WITHOUT an explicit width/height it collapses to 0px — invisible, and impossible to grab
        // with a mouse. It must own its own thickness. `aria-orientation` is the *separator's* axis
        // (vertical in a horizontal group), which is what decides which dimension to pin.
        // Transparent by default: the panes are separate cards with a gutter between them, so the
        // seam is already legible and a permanent line drawn down it just adds a third edge beside
        // the two card borders. The handle earns its ink only while you are aiming at it.
        'relative shrink-0 rounded-full bg-transparent outline-none',
        'aria-[orientation=vertical]:w-1 aria-[orientation=vertical]:cursor-col-resize',
        'aria-[orientation=horizontal]:h-1 aria-[orientation=horizontal]:cursor-row-resize',
        // A 1px line is honest visually and hostile to a mouse, so the grab area is widened to 9px
        // with an invisible overlay — the same trick VS Code uses. Without it, hitting the divider
        // is a pixel-hunt, which is most of what "feels unpolished" means when resizing panes.
        'after:absolute after:z-10 after:content-[""]',
        'aria-[orientation=vertical]:after:inset-y-0 aria-[orientation=vertical]:after:-inset-x-1',
        'aria-[orientation=horizontal]:after:inset-x-0 aria-[orientation=horizontal]:after:-inset-y-1',
        'transition-colors duration-(--fx-motion-duration-fast) ease-(--ease-entrance)',
        // `data-separator` is present in EVERY state (including idle), so a bare `data-[separator]:`
        // attribute selector painted the divider accent permanently. Match the drag state by value.
        'hover:bg-border-strong data-[separator=active]:bg-accent',
        'focus-visible:bg-accent focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus-ring focus-visible:outline',
        className,
      )}
      {...props}
    />
  );
}
