import {
  Kbd,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
} from '@fixora/ui';
import { useId } from 'react';

import { useUiStore } from '../../stores/ui-store.js';
import { useCommands } from '../commands/command-provider.js';
import { formatBinding } from '../commands/keybinding.js';

/**
 * The settings surface (roadmap M2): theme, density, telemetry opt-in, and the keybinding list.
 * Everything here is a local preference — nothing on this screen touches the network. Telemetry is
 * **off by default** and the copy says plainly what it is (FR-5): the actual sentence, in the app,
 * where the decision is made — not a link to a policy.
 */
export function SettingsPanel(): React.JSX.Element {
  return (
    <section
      aria-label="Settings"
      className="flex h-full flex-col overflow-y-auto border-r border-border-subtle bg-canvas"
    >
      <header className="flex h-8 shrink-0 items-center border-b border-border-subtle px-3">
        <span className="text-xs font-semibold text-fg">Settings</span>
      </header>
      <div className="flex flex-col gap-6 p-4">
        <AppearanceSettings />
        <PrivacySettings />
        <Keybindings />
      </div>
    </section>
  );
}

function AppearanceSettings(): React.JSX.Element {
  const theme = useUiStore((s) => s.theme);
  const density = useUiStore((s) => s.density);
  const setTheme = useUiStore((s) => s.setTheme);
  const setDensity = useUiStore((s) => s.setDensity);
  const themeId = useId();
  const densityId = useId();

  return (
    <Group title="Appearance">
      <Field label="Theme" htmlFor={themeId}>
        <Select
          value={theme}
          onValueChange={(v) => {
            setTheme(v as typeof theme);
          }}
        >
          <SelectTrigger id={themeId} className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="dark">Dark</SelectItem>
            <SelectItem value="light">Light</SelectItem>
          </SelectContent>
        </Select>
      </Field>
      <Field label="Density" htmlFor={densityId}>
        <Select
          value={density}
          onValueChange={(v) => {
            setDensity(v as typeof density);
          }}
        >
          <SelectTrigger id={densityId} className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="comfortable">Comfortable</SelectItem>
            <SelectItem value="compact">Compact</SelectItem>
          </SelectContent>
        </Select>
      </Field>
    </Group>
  );
}

function PrivacySettings(): React.JSX.Element {
  const telemetryEnabled = useUiStore((s) => s.telemetryEnabled);
  const setTelemetryEnabled = useUiStore((s) => s.setTelemetryEnabled);
  const switchId = useId();

  return (
    <Group title="Privacy">
      <div className="flex items-start justify-between gap-4">
        <label htmlFor={switchId} className="flex flex-col gap-0.5">
          <span className="text-sm text-fg">Anonymous usage telemetry</span>
          <span className="max-w-md text-xs text-fg-muted">
            Off by default. If enabled, Fixora sends anonymous, event-level counts (like &ldquo;a
            fix was applied&rdquo;) — never your code, file names, or repository identity.
          </span>
        </label>
        <Switch
          id={switchId}
          checked={telemetryEnabled}
          onCheckedChange={setTelemetryEnabled}
          aria-label="Anonymous usage telemetry"
        />
      </div>
    </Group>
  );
}

function Keybindings(): React.JSX.Element {
  const registry = useCommands();
  const commands = registry.all().filter((c) => c.keybinding !== undefined);

  return (
    <Group title="Keyboard shortcuts">
      <ul className="flex flex-col divide-y divide-border-subtle">
        {commands.map((command) => (
          <li key={command.id} className="flex items-center justify-between py-1.5 text-sm">
            <span className="text-fg-secondary">{command.title}</span>
            {command.keybinding !== undefined && <Kbd>{formatBinding(command.keybinding)}</Kbd>}
          </li>
        ))}
      </ul>
    </Group>
  );
}

function Group({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-muted">{title}</h3>
      {children}
    </div>
  );
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="flex items-center justify-between gap-4">
      <label htmlFor={htmlFor} className="text-sm text-fg">
        {label}
      </label>
      {children}
    </div>
  );
}
