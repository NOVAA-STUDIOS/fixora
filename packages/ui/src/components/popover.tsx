import * as PopoverPrimitive from '@radix-ui/react-popover';
import { forwardRef, type ComponentPropsWithoutRef, type ComponentRef } from 'react';

import { cn } from '../lib/cn.js';

/**
 * Radix Popover, styled.
 *
 * The distinction from `Select` matters and is why this exists: a select popup is trigger-width by
 * contract, which is correct for "Dark / Light" and actively harmful for a searchable catalogue of
 * eighty models with long names. A popover sizes to its own content, so a combobox built on it can
 * show what it is asking the user to choose between.
 *
 * Radix owns the positioning (collision flipping, viewport clamping), the focus trap and the
 * dismiss behaviour; we own the surface and the motion.
 */
export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export const PopoverAnchor = PopoverPrimitive.Anchor;

export const PopoverContent = forwardRef<
  ComponentRef<typeof PopoverPrimitive.Content>,
  ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(function PopoverContent({ className, align = 'center', sideOffset = 6, ...props }, ref) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        ref={ref}
        align={align}
        sideOffset={sideOffset}
        className={cn(
          'z-(--fx-z-popover) overflow-hidden rounded-xl',
          'border border-border-subtle bg-overlay text-fg shadow-lg',
          // Grows from the edge it is anchored to, so it reads as opening out of its trigger.
          'origin-(--radix-popover-content-transform-origin)',
          'data-[state=open]:animate-in data-[state=closed]:animate-out motion-reduce:animate-none',
          className,
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
});
