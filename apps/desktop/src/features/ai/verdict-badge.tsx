import type { Verdict } from '@fixora/shared-types';
import { cn } from '@fixora/ui';

/**
 * The verification verdict, as a small coloured badge (ADR-003). Shared by the live repair panel and
 * the history list so a verdict looks the same wherever it appears.
 */
const VERDICT_STYLE: Record<Verdict, { label: string; className: string }> = {
  verified: { label: 'Verified', className: 'bg-success-bg text-success-text' },
  regression: { label: 'Regression', className: 'bg-danger-bg text-danger-text' },
  unresolved: { label: 'Unresolved', className: 'bg-warning-bg text-fg-secondary' },
  skipped: { label: 'Not verified', className: 'bg-hover text-fg-muted' },
};

export function VerdictBadge({ verdict }: { verdict: Verdict }): React.JSX.Element {
  const style = VERDICT_STYLE[verdict];
  return (
    <span
      className={cn('rounded px-1.5 py-0.5 text-[10px] font-medium normal-case', style.className)}
    >
      {style.label}
    </span>
  );
}
