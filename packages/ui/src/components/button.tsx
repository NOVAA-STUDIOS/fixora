import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { forwardRef, type ButtonHTMLAttributes } from 'react';

import { cn } from '../lib/cn.js';

/**
 * The base ring/disabled/transition contract every interactive primitive inherits. Focus is
 * always `focus-visible` (keyboard only) with the 2px offset the token contract depends on
 * (packages/tokens/src/requirements.ts); the ring colour is a token, so it is contrast-gated.
 * Motion uses the token duration, which collapses to 1ms under `prefers-reduced-motion` at the
 * CSS layer — the component does not have to remember.
 */
const focusRing =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring focus-visible:outline';

export const buttonVariants = cva(
  cn(
    'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md font-medium',
    'select-none transition-colors duration-(--fx-motion-duration-fast) ease-(--ease-entrance)',
    'disabled:pointer-events-none disabled:opacity-50',
    focusRing,
  ),
  {
    variants: {
      variant: {
        primary: 'bg-accent text-on-accent hover:bg-accent-hover active:bg-accent-active',
        secondary: 'bg-raised text-fg border border-border-strong hover:bg-hover active:bg-active',
        ghost: 'bg-transparent text-fg-secondary hover:bg-hover hover:text-fg active:bg-active',
        danger: 'bg-danger text-on-danger hover:opacity-90 active:opacity-100',
      },
      size: {
        sm: 'h-(--fx-control-height-sm) px-(--fx-control-padding-x) text-sm',
        md: 'h-(--fx-control-height-md) px-(--fx-control-padding-x) text-sm',
        lg: 'h-(--fx-control-height-lg) px-(--fx-control-padding-x) text-md',
        // A square icon-only button. Width tracks height so it stays a circle-of-influence square.
        icon: 'h-(--fx-control-height-md) w-(--fx-control-height-md)',
      },
    },
    defaultVariants: { variant: 'secondary', size: 'md' },
  },
);

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & {
    /** Render as the child element (Radix Slot) — e.g. a link that looks like a button. */
    asChild?: boolean;
  };

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, asChild = false, type, ...props },
  ref,
) {
  const Comp = asChild ? Slot : 'button';
  return (
    <Comp
      ref={ref}
      // A bare <button> in a form defaults to type="submit" and will submit it by surprise.
      // Default to "button" unless the caller asks otherwise. Slot forwards this to its child.
      type={asChild ? undefined : (type ?? 'button')}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
});
