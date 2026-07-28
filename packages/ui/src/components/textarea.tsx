import { forwardRef, type TextareaHTMLAttributes } from 'react';

import { cn } from '../lib/cn.js';

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  /** Marks the field as failing validation: sets `aria-invalid` and a danger border. */
  invalid?: boolean;
};

/**
 * A multi-line text field, styled to match `Input`. It does not resize itself — a caller that wants
 * auto-growing height (the Suggestion form does) drives `rows`/height from its own ref, because that
 * behaviour depends on the caller's content and layout, not on anything the primitive should own.
 */
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { className, invalid = false, 'aria-invalid': ariaInvalid, ...props },
  ref,
) {
  return (
    <textarea
      ref={ref}
      aria-invalid={ariaInvalid ?? invalid}
      className={cn(
        'w-full resize-none rounded-md px-(--fx-control-padding-x) py-2 text-sm leading-relaxed',
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
