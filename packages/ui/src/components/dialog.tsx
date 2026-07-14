import * as DialogPrimitive from '@radix-ui/react-dialog';
import { forwardRef, type ComponentPropsWithoutRef, type ComponentRef } from 'react';

import { cn } from '../lib/cn.js';

/**
 * Radix Dialog, styled. Radix owns the accessibility that a hand-rolled modal always gets wrong:
 * focus is trapped inside while open and restored to the trigger on close, the background is
 * `aria-hidden` and inert, Escape closes, and the title/description are wired to
 * `aria-labelledby`/`aria-describedby`. We provide the surface and the animation.
 *
 * `DialogTitle` is not optional — Radix warns (correctly) that a dialog without a title is
 * unusable with a screen reader. If a design has no visible title, wrap one in `VisuallyHidden`.
 */
export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;
export const DialogTitle = DialogPrimitive.Title;
export const DialogDescription = DialogPrimitive.Description;

export const DialogContent = forwardRef<
  ComponentRef<typeof DialogPrimitive.Content>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(function DialogContent({ className, children, ...props }, ref) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay
        className={cn(
          'fixed inset-0 z-(--fx-z-dialog) bg-black/50',
          'data-[state=open]:animate-in data-[state=closed]:animate-out motion-reduce:animate-none',
        )}
      />
      <DialogPrimitive.Content
        ref={ref}
        className={cn(
          'fixed left-1/2 top-1/2 z-(--fx-z-dialog) w-full max-w-lg -translate-x-1/2 -translate-y-1/2',
          'rounded-lg bg-raised text-fg border border-border-subtle p-6 shadow-lg',
          'focus:outline-none',
          'data-[state=open]:animate-in data-[state=closed]:animate-out motion-reduce:animate-none',
          className,
        )}
        {...props}
      >
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
});
