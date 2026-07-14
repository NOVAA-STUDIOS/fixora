import { type HTMLAttributes } from 'react';

import { cn } from '../lib/cn.js';

/**
 * A loading placeholder. "A spinner for 20 seconds is a product failure" (TDD §8.3) — a skeleton
 * that mirrors the shape of the content that is coming reads as progress, not as a stall.
 *
 * The pulse is gated behind `motion-reduce:animate-none`, so a user who asked for less motion
 * gets a static placeholder rather than a throbbing one.
 */
export function Skeleton({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>): React.JSX.Element {
  return (
    <div
      // Decorative: announced by nothing. The surrounding region owns the "loading" semantics.
      aria-hidden="true"
      className={cn('animate-pulse rounded-md bg-hover motion-reduce:animate-none', className)}
      {...props}
    />
  );
}
