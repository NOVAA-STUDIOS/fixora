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
          // Bounded by the window, not only by its own max-width. The app's minimum window is
          // 940×600 and the user may be at 150% scaling on top of that, so a dialog sized purely by
          // its content runs off the edges — where, being `fixed`, it cannot be scrolled back into
          // view. The clamp is on `w-` rather than `max-w-` deliberately: consumers override
          // `max-w-*` (the palette sets `max-w-xl`), and tailwind-merge would drop a viewport cap
          // expressed in the same group, silently taking the guard with it.
          'fixed left-1/2 top-1/2 z-(--fx-z-dialog) w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2',
          'max-h-[calc(100dvh-4rem)] overflow-y-auto',
          'rounded-3xl bg-[#111111] text-fg border border-white/[0.08] p-6 shadow-2xl',
          'focus:outline-none',
          // Dialog-specific keyframes, not the generic `.animate-ios-enter` — this element also
          // centers itself with a static `translate(-50%,-50%)`, which the generic version would
          // clobber for the animation's duration.
          'data-[state=open]:animate-ios-dialog-enter data-[state=closed]:animate-ios-dialog-exit motion-reduce:animate-none',
          className,
        )}
        {...props}
      >
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
});
