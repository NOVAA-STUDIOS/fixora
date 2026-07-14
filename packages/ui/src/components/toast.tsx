import * as ToastPrimitive from '@radix-ui/react-toast';
import { cva, type VariantProps } from 'class-variance-authority';
import { forwardRef, type ComponentPropsWithoutRef, type ComponentRef } from 'react';

import { cn } from '../lib/cn.js';

/**
 * Radix Toast, styled. Radix handles the parts that make a toast accessible rather than
 * annoying: it uses an ARIA live region so a screen reader announces it, it pauses the
 * auto-dismiss timer on hover and focus (so a keyboard user can actually reach the action before
 * it vanishes), and it supports swipe-to-dismiss. We provide the surface and the tones.
 */
export const ToastProvider = ToastPrimitive.Provider;
export const ToastAction = ToastPrimitive.Action;
export const ToastClose = ToastPrimitive.Close;
export const ToastTitle = ToastPrimitive.Title;
export const ToastDescription = ToastPrimitive.Description;

export const ToastViewport = forwardRef<
  ComponentRef<typeof ToastPrimitive.Viewport>,
  ComponentPropsWithoutRef<typeof ToastPrimitive.Viewport>
>(function ToastViewport({ className, ...props }, ref) {
  return (
    <ToastPrimitive.Viewport
      ref={ref}
      className={cn(
        'fixed bottom-0 right-0 z-(--fx-z-toast) flex max-h-screen w-96 max-w-full flex-col gap-2 p-4',
        className,
      )}
      {...props}
    />
  );
});

const toastVariants = cva(
  cn(
    'flex items-start gap-3 rounded-lg border p-4 shadow-lg',
    'data-[state=open]:animate-in data-[state=closed]:animate-out motion-reduce:animate-none',
  ),
  {
    variants: {
      tone: {
        neutral: 'bg-overlay text-fg border-border-subtle',
        danger: 'bg-overlay text-fg border-danger-border',
        success: 'bg-overlay text-fg border-success-border',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
);

export const Toast = forwardRef<
  ComponentRef<typeof ToastPrimitive.Root>,
  ComponentPropsWithoutRef<typeof ToastPrimitive.Root> & VariantProps<typeof toastVariants>
>(function Toast({ className, tone, ...props }, ref) {
  return (
    <ToastPrimitive.Root ref={ref} className={cn(toastVariants({ tone }), className)} {...props} />
  );
});
