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

/**
 * A setting picked from a small fixed set — a native `<select>`, not a custom listbox: there is no
 * `Select`/`SelectContent` primitive plumbed through this file (see the header comment on why this
 * module exists), and a handful of options is exactly what the native control is for.
 */
export function SelectField<T extends string | number>({
  label,
  htmlFor,
  options,
  value,
  onChange,
}: {
  label: string;
  htmlFor: string;
  options: readonly T[];
  value: T;
  onChange: (v: T) => void;
}): React.JSX.Element {
  return (
    <div className="flex items-center justify-between gap-8">
      <label htmlFor={htmlFor} className="text-sm font-medium text-fg">
        {label}
      </label>
      <select
        id={htmlFor}
        value={String(value)}
        onChange={(e) => {
          const raw = e.target.value;
          const matched = options.find((o) => String(o) === raw);
          if (matched !== undefined) onChange(matched);
        }}
        className="rounded-md border border-border-strong bg-raised px-2 py-1 text-xs text-fg focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus-ring focus-visible:outline"
      >
        {options.map((o) => (
          <option key={String(o)} value={String(o)}>
            {String(o)}
          </option>
        ))}
      </select>
    </div>
  );
}

/** A bounded numeric setting — a native `<input type="range">`, same reasoning as `SelectField`. */
export function SliderField({
  label,
  htmlFor,
  min,
  max,
  value,
  onChange,
}: {
  label: string;
  htmlFor: string;
  min: number;
  max: number;
  value: number;
  onChange: (v: number) => void;
}): React.JSX.Element {
  return (
    <div className="flex items-center justify-between gap-8">
      <label htmlFor={htmlFor} className="text-sm font-medium text-fg">
        {label}
      </label>
      <div className="flex shrink-0 items-center gap-2">
        <input
          id={htmlFor}
          type="range"
          min={min}
          max={max}
          value={value}
          onChange={(e) => {
            onChange(Number(e.target.value));
          }}
          className="w-32"
        />
        <span className="w-6 text-right text-xs tabular-nums text-fg-muted">{value}</span>
      </div>
    </div>
  );
}
