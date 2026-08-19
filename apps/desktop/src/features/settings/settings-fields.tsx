import { Switch } from '@fixora/ui';

/**
 * Shared by `settings-panel.tsx` and any settings card outside it (e.g. `github-actions-panel.tsx`)
 * — pulled out of `settings-panel.tsx` specifically to avoid a two-file import cycle: that file
 * renders `GitHubActionsPanel`, so `GitHubActionsPanel` cannot import these back from it.
 */

/** A titled section of related settings. */
export function Group({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <section className="flex flex-col gap-4">
      <h3 className="border-b border-border-subtle pb-2 text-sm font-semibold text-fg">{title}</h3>
      {children}
    </section>
  );
}

/**
 * A boolean setting: label and explanation on the left, a `Switch` on the right — the same
 * skeleton every toggle row in Settings uses.
 */
export function ToggleField({
  label,
  htmlFor,
  description,
  checked,
  onCheckedChange,
}: {
  label: string;
  htmlFor: string;
  description: string;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
}): React.JSX.Element {
  return (
    <div className="flex items-start justify-between gap-8">
      <label htmlFor={htmlFor} className="flex min-w-0 cursor-pointer flex-col gap-0.5">
        <span className="text-sm font-medium text-fg">{label}</span>
        <span className="text-xs leading-relaxed text-fg-muted">{description}</span>
      </label>
      <Switch
        className="mt-0.5 shrink-0"
        id={htmlFor}
        checked={checked}
        onCheckedChange={onCheckedChange}
        aria-label={label}
      />
    </div>
  );
}
