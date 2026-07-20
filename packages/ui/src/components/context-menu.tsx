import * as ContextMenuPrimitive from '@radix-ui/react-context-menu';
import { forwardRef, type ComponentPropsWithoutRef, type ComponentRef } from 'react';

import { cn } from '../lib/cn.js';

/**
 * A right-click menu, on Radix.
 *
 * Desktop applications are expected to answer a right-click, and a list row that does not is one of
 * the clearest tells that something is a web page in a window rather than an app. Radix owns the
 * parts that are easy to get wrong and impossible to notice until they bite: the menu closes on
 * Escape and on outside-click, focus is trapped and restored, arrow keys and typeahead work, and
 * the trigger is not tab-stealing. We own the surface, the density and the motion.
 */
export const ContextMenu = ContextMenuPrimitive.Root;
export const ContextMenuTrigger = ContextMenuPrimitive.Trigger;
export const ContextMenuGroup = ContextMenuPrimitive.Group;

export const ContextMenuContent = forwardRef<
  ComponentRef<typeof ContextMenuPrimitive.Content>,
  ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Content>
>(function ContextMenuContent({ className, ...props }, ref) {
  return (
    <ContextMenuPrimitive.Portal>
      <ContextMenuPrimitive.Content
        ref={ref}
        className={cn(
          'z-(--fx-z-popover) min-w-56 overflow-hidden rounded-lg p-1',
          'border border-border-subtle bg-overlay text-fg shadow-lg',
          // Scales from the pointer rather than appearing instantly — the menu reads as coming
          // *from* the thing you clicked. Radix exposes the origin; reduce-motion drops it.
          'origin-(--radix-context-menu-content-transform-origin)',
          'data-[state=open]:animate-in data-[state=closed]:animate-out motion-reduce:animate-none',
          className,
        )}
        {...props}
      />
    </ContextMenuPrimitive.Portal>
  );
});

export const ContextMenuItem = forwardRef<
  ComponentRef<typeof ContextMenuPrimitive.Item>,
  ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Item> & { danger?: boolean }
>(function ContextMenuItem({ className, danger = false, ...props }, ref) {
  return (
    <ContextMenuPrimitive.Item
      ref={ref}
      className={cn(
        'relative flex cursor-default select-none items-center gap-2.5 rounded-md px-2.5 py-1.5',
        'text-sm outline-none transition-colors duration-(--fx-motion-duration-instant)',
        'data-[disabled]:pointer-events-none data-[disabled]:opacity-40',
        danger
          ? 'text-danger-text data-[highlighted]:bg-danger-subtle'
          : 'text-fg-secondary data-[highlighted]:bg-hover data-[highlighted]:text-fg',
        className,
      )}
      {...props}
    />
  );
});

export function ContextMenuSeparator({ className }: { className?: string }): React.JSX.Element {
  return (
    <ContextMenuPrimitive.Separator className={cn('-mx-1 my-1 h-px bg-border-subtle', className)} />
  );
}

/** The right-hand hint in a menu row (a shortcut, or a destination). Never competes with the label. */
export function ContextMenuShortcut({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}): React.JSX.Element {
  return (
    <span className={cn('ml-auto pl-4 text-[11px] tracking-wide text-fg-muted', className)}>
      {children}
    </span>
  );
}
