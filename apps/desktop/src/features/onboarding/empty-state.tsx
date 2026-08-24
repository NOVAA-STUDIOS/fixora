import { Button } from '@fixora/ui';
import type { ReactNode } from 'react';

export type EmptyStateProps = {
  icon: ReactNode;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
};

/** A reusable "there is nothing here" surface: icon, title, one line of description, and an
 * optional single action. Used wherever a panel has nothing to show. */
export function EmptyState({
  icon,
  title,
  description,
  actionLabel,
  onAction,
}: EmptyStateProps): React.JSX.Element {
  return (
    <div className="flex h-full flex-1 flex-col items-center justify-center gap-3 px-6 py-10 text-center">
      <div className="text-4xl" aria-hidden="true">
        {icon}
      </div>
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium text-fg">{title}</p>
        <p className="max-w-xs text-xs text-fg-muted">{description}</p>
      </div>
      {actionLabel !== undefined && onAction !== undefined && (
        <Button variant="secondary" size="sm" onClick={onAction}>
          {actionLabel}
        </Button>
      )}
    </div>
  );
}
