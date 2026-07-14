import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { forwardRef, type ComponentPropsWithoutRef, type ComponentRef } from 'react';

import { cn } from '../lib/cn.js';

/**
 * Radix Tooltip, styled. Radix handles the hard parts we would get wrong by hand: it is
 * dismissible with Escape, it does not trap focus, it respects hover/focus intent with a delay,
 * and it never shows on touch (where a tooltip is a trap). We only supply the surface.
 *
 * A tooltip is **not** an accessible name — it is supplementary. Do not put the only label for a
 * control in a tooltip; use it for the shortcut hint or the extra sentence.
 */
export const TooltipProvider = TooltipPrimitive.Provider;
export const Tooltip = TooltipPrimitive.Root;
export const TooltipTrigger = TooltipPrimitive.Trigger;

export const TooltipContent = forwardRef<
  ComponentRef<typeof TooltipPrimitive.Content>,
  ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(function TooltipContent({ className, sideOffset = 6, children, ...props }, ref) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        ref={ref}
        sideOffset={sideOffset}
        className={cn(
          'z-(--fx-z-popover) max-w-xs rounded-md px-2.5 py-1.5 text-xs',
          'bg-overlay text-fg border border-border-subtle shadow-md',
          'data-[state=delayed-open]:animate-in data-[state=closed]:animate-out',
          'motion-reduce:animate-none',
          className,
        )}
        {...props}
      >
        {children}
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  );
});
