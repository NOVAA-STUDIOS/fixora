import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu';
import { forwardRef, type ComponentPropsWithoutRef, type ComponentRef } from 'react';

import { cn } from '../lib/cn.js';

/**
 * Radix Dropdown Menu, styled — used for context menus and the (future) menu bar. Radix provides
 * the WAI-ARIA menu pattern: arrow-key navigation, typeahead, Escape to close, focus return, and
 * correct `role`/`aria` wiring. We style the surface and the items.
 */
export const DropdownMenu = DropdownMenuPrimitive.Root;
export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;
export const DropdownMenuGroup = DropdownMenuPrimitive.Group;

export const DropdownMenuContent = forwardRef<
  ComponentRef<typeof DropdownMenuPrimitive.Content>,
  ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content>
>(function DropdownMenuContent({ className, sideOffset = 4, ...props }, ref) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        ref={ref}
        sideOffset={sideOffset}
        className={cn(
          'z-(--fx-z-popover) min-w-44 overflow-hidden rounded-md p-1',
          // No backdrop-filter (froze the GPU process in Electron before) — a near-opaque solid
          // color stands in for the blur, the same pattern .glass-panel/.glass-overlay use.
          'bg-[color-mix(in_srgb,var(--fx-color-bg-overlay)_85%,transparent)] text-fg border border-border-subtle shadow-lg',
          'data-[state=open]:animate-in data-[state=closed]:animate-out motion-reduce:animate-none',
          className,
        )}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  );
});

export const DropdownMenuItem = forwardRef<
  ComponentRef<typeof DropdownMenuPrimitive.Item>,
  ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item> & { danger?: boolean }
>(function DropdownMenuItem({ className, danger = false, ...props }, ref) {
  return (
    <DropdownMenuPrimitive.Item
      ref={ref}
      className={cn(
        'relative flex h-(--fx-row-height) cursor-default select-none items-center gap-2 rounded-sm',
        'px-2 text-sm outline-none',
        'data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        danger
          ? 'text-danger-text data-[highlighted]:bg-danger-subtle'
          : 'data-[highlighted]:bg-hover data-[highlighted]:text-fg',
        className,
      )}
      {...props}
    />
  );
});

export const DropdownMenuSeparator = forwardRef<
  ComponentRef<typeof DropdownMenuPrimitive.Separator>,
  ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Separator>
>(function DropdownMenuSeparator({ className, ...props }, ref) {
  return (
    <DropdownMenuPrimitive.Separator
      ref={ref}
      className={cn('my-1 h-px bg-border-subtle', className)}
      {...props}
    />
  );
});

export function DropdownMenuShortcut({
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement>): React.JSX.Element {
  return <span className={cn('ml-auto text-xs text-fg-muted', className)} {...props} />;
}
