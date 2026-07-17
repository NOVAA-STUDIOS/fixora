import { AI_MODEL_OPTIONS } from '@fixora/shared-types';
import {
  Button,
  Input,
  Kbd,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
} from '@fixora/ui';
import { useEffect, useId, useState } from 'react';

import { useAiStore } from '../../stores/ai-store.js';
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
        <AiSettings />
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

function AiSettings(): React.JSX.Element {
  const config = useAiStore((s) => s.config);
  const loadConfig = useAiStore((s) => s.loadConfig);
  const setKey = useAiStore((s) => s.setKey);
  const clearKey = useAiStore((s) => s.clearKey);
  const setModel = useAiStore((s) => s.setModel);

  const keyId = useId();
  const modelId = useId();
  const [draftKey, setDraftKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  const configured = config?.configured ?? false;
  const model = config?.model ?? AI_MODEL_OPTIONS[0];

  const save = async (): Promise<void> => {
    if (draftKey.trim().length === 0) return;
    setSaving(true);
    setError(null);
    const message = await setKey(draftKey.trim(), model);
    setSaving(false);
    if (message !== null) {
      setError(message);
      return;
    }
    setDraftKey('');
  };

  return (
    <Group title="AI (bring your own key)">
      <p className="max-w-md text-xs text-fg-muted">
        Fixora uses <span className="text-fg-secondary">your</span> provider key, stored encrypted in
        your OS keychain and never sent anywhere but the provider you choose. Get an OpenRouter key at
        openrouter.ai. Your code never passes through Fixora&rsquo;s servers.
      </p>

      <Field label="Model" htmlFor={modelId}>
        <Select
          value={model}
          onValueChange={(v) => {
            void setModel(v);
          }}
        >
          <SelectTrigger id={modelId} className="w-60">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {AI_MODEL_OPTIONS.map((m) => (
              <SelectItem key={m} value={m}>
                {m}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      {configured ? (
        <div className="flex items-center justify-between gap-4">
          <span className="text-sm text-fg">
            Key configured{' '}
            <span className="text-fg-muted">({config?.keyHint ?? '••••'})</span>
          </span>
          <Button variant="ghost" size="sm" onClick={() => void clearKey()}>
            Remove key
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <label htmlFor={keyId} className="text-sm text-fg">
            OpenRouter API key
          </label>
          <div className="flex items-center gap-2">
            <Input
              id={keyId}
              type="password"
              autoComplete="off"
              placeholder="sk-or-v1-…"
              value={draftKey}
              onChange={(e) => {
                setDraftKey(e.target.value);
              }}
              className="flex-1"
            />
            <Button size="sm" onClick={() => void save()} disabled={saving || draftKey.trim().length === 0}>
              Save
            </Button>
          </div>
          {error !== null && <span className="text-xs text-danger-text">{error}</span>}
        </div>
      )}
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
