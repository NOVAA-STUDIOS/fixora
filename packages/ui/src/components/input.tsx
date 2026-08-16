import { forwardRef, type InputHTMLAttributes } from 'react';

import { cn } from '../lib/cn.js';

export type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  /** Marks the field as failing validation: sets `aria-invalid` and a danger border. */
  invalid?: boolean;
};

/**
 * A text input. Height and padding come from the density tokens, so it tightens with the rest
 * of the app when compact. `invalid` drives both the visual state and `aria-invalid`, so the two
 * cannot disagree — a red border a screen reader does not announce is a lie to sighted users.
 */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, invalid = false, 'aria-invalid': ariaInvalid, ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      aria-invalid={ariaInvalid ?? invalid}
      className={cn(
        'h-(--fx-control-height-md) w-full rounded-xl px-(--fx-control-padding-x) text-sm',
        'bg-inset text-fg placeholder:text-fg-muted',
        'border border-border-strong',
        'transition-colors duration-(--fx-motion-duration-fast) ease-(--ease-entrance)',
        'hover:border-accent-border',
        'focus-visible:border-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring focus-visible:outline',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'aria-[invalid=true]:border-danger aria-[invalid=true]:focus-visible:outline-danger',
        className,
      )}
      {...props}
    />
  );
});
