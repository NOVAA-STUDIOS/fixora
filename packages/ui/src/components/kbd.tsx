import { type HTMLAttributes } from 'react';

import { cn } from '../lib/cn.js';

/**
 * A keyboard-key hint (`⌘`, `K`, `Esc`). Used in the command palette, menus and shortcut lists.
 * Renders `<kbd>`, the semantically correct element, so assistive tech announces it as keyboard
 * input rather than as decorative text.
 */
export function Kbd({
  className,
  children,
  ...props
}: HTMLAttributes<HTMLElement>): React.JSX.Element {
  return (
    <kbd
      className={cn(
        'inline-flex min-w-5 items-center justify-center rounded-sm px-1.5 py-0.5',
        'bg-raised text-fg-muted border border-border-subtle',
        'font-mono text-xs leading-none',
        className,
      )}
      {...props}
    >
      {children}
    </kbd>
  );
}
