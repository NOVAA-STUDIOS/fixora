import { cva, type VariantProps } from 'class-variance-authority';
import { type HTMLAttributes } from 'react';

import { cn } from '../lib/cn.js';

/**
 * A status/severity chip. The `tone` values map to the semantic status colours, whose
 * label-on-solid pairs are contrast-gated (packages/tokens/src/requirements.ts) — so a severity
 * a user has to read is always readable. This is the component M3's findings panel leans on, and
 * a finding a user cannot read is a finding we did not report.
 */
export const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium leading-none',
  {
    variants: {
      tone: {
        neutral: 'bg-raised text-fg-secondary border border-border-subtle',
        accent: 'bg-accent-subtle text-accent-text border border-accent-border',
        danger: 'bg-danger text-on-danger',
        warn: 'bg-warn text-on-warn',
        success: 'bg-success text-on-success',
        info: 'bg-info text-on-info',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
);

export type BadgeProps = HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>;

export function Badge({ className, tone, ...props }: BadgeProps): React.JSX.Element {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}
