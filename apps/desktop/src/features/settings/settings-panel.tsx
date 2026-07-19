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
import { isPro, useLicenseStore } from '../../stores/license-store.js';
import { useUiStore } from '../../stores/ui-store.js';
import { useCommands } from '../commands/command-provider.js';
import { formatBinding } from '../commands/keybinding.js';

const PURCHASE_URL = 'https://fixora.dev/pro';

const LICENSE_REASON_MESSAGE: Record<string, string> = {
  'licensing-not-configured': "Licensing isn't enabled in this build yet.",
  malformed: "That doesn't look like a valid license key.",
  'bad-signature': 'This license key is invalid.',
  expired: 'This license has expired.',
};

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
      className="flex h-full min-w-0 flex-col overflow-y-auto overflow-x-hidden border-r border-border-subtle bg-canvas"
    >
      <header className="flex h-8 shrink-0 items-center border-b border-border-subtle px-3">
        <span className="text-xs font-semibold text-fg">Settings</span>
      </header>
      <div className="flex flex-col gap-6 p-4">
        <AppearanceSettings />
        <EditorSettings />
      <StartupSettings />
        <AiSettings />
        <LicenseSettings />
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
          <SelectTrigger id={themeId} className="w-full">
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
          <SelectTrigger id={densityId} className="w-full">
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
  const models = useAiStore((s) => s.models);
  const loadModels = useAiStore((s) => s.loadModels);
  const dismissMigrationNotice = useAiStore((s) => s.dismissMigrationNotice);

  const keyId = useId();
  const modelId = useId();
  const [draftKey, setDraftKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void loadConfig();
    void loadModels();
  }, [loadConfig, loadModels]);

  const configured = config?.configured ?? false;
  const model = config?.model ?? '';

  // Only models OpenRouter currently offers. A retired id is not in this list, so it cannot be
  // picked again — and free ones sort first so the zero-cost path is the obvious one.
  const modelOptions = [...(models?.models ?? [])].sort((a, b) => {
    if (a.free !== b.free) return a.free ? -1 : 1;
    if (a.codeCapable !== b.codeCapable) return a.codeCapable ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

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
        Fixora uses <span className="text-fg-secondary">your</span> provider key, stored encrypted
        in your OS keychain and never sent anywhere but the provider you choose. Get an OpenRouter
        key at openrouter.ai. Your code never passes through Fixora&rsquo;s servers.
      </p>

      {/* Explains a model the user did not choose. Shown once, then dismissed — a notice that
          cannot be cleared becomes furniture people stop reading. */}
      {config?.migratedFrom !== null && config?.migratedFrom !== undefined && (
        <div
          role="status"
          className="flex items-start justify-between gap-3 rounded border border-border-subtle bg-inset px-3 py-2"
        >
          <p className="text-xs leading-relaxed text-fg-secondary">
            <span className="font-medium text-fg">Model changed.</span>{' '}
            <span className="font-mono">{config.migratedFrom}</span> is no longer offered by
            OpenRouter, so Fixora switched you to <span className="font-mono">{model}</span>. Pick a
            different one below at any time.
          </p>
          <button
            type="button"
            onClick={dismissMigrationNotice}
            className="shrink-0 rounded px-2 py-0.5 text-xs text-fg-muted hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus-ring focus-visible:outline"
          >
            Got it
          </button>
        </div>
      )}

      <Field label="Model" htmlFor={modelId}>
        <Select
          value={model}
          onValueChange={(v) => {
            void setModel(v);
          }}
        >
          <SelectTrigger id={modelId} className="w-full">
            <SelectValue
              placeholder={modelOptions.length === 0 ? 'Loading models…' : 'Select a model'}
            />
          </SelectTrigger>
          <SelectContent>
            {/* Free first: the beta should not cost anyone credits to try. Paid models stay
                available below — switching to Claude, GPT or Gemini is always the user's call. */}
            {modelOptions.map((m) => (
              // title: the full id stays reachable on hover once the label truncates.
              <SelectItem key={m.id} value={m.id} title={m.id}>
                {m.free ? `${m.name} · free` : m.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      {models?.notice !== null && models?.notice !== undefined && (
        <p className="text-xs text-warning-text">{models.notice}</p>
      )}

      {configured ? (
        <div className="flex items-center justify-between gap-4">
          <span className="text-sm text-fg">
            Key configured <span className="text-fg-muted">({config?.keyHint ?? '••••'})</span>
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
            <Button
              size="sm"
              onClick={() => void save()}
              disabled={saving || draftKey.trim().length === 0}
            >
              Save
            </Button>
          </div>
          {error !== null && <span className="text-xs text-danger-text">{error}</span>}
        </div>
      )}
    </Group>
  );
}

function LicenseSettings(): React.JSX.Element {
  const status = useLicenseStore((s) => s.status);
  const load = useLicenseStore((s) => s.load);
  const activate = useLicenseStore((s) => s.activate);
  const deactivate = useLicenseStore((s) => s.deactivate);

  const keyId = useId();
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void load();
  }, [load]);

  const pro = isPro(status);

  const activateNow = async (): Promise<void> => {
    if (draft.trim().length === 0) return;
    setBusy(true);
    setError(null);
    const result = await activate(draft.trim());
    setBusy(false);
    if (result === null) {
      setError('Something went wrong activating the license.');
      return;
    }
    if (result.valid) {
      setDraft('');
      return;
    }
    setError(LICENSE_REASON_MESSAGE[result.reason ?? ''] ?? 'This license key was not accepted.');
  };

  return (
    <Group title="License">
      {pro ? (
        <div className="flex items-center justify-between gap-4">
          <span className="text-sm text-fg">
            Fixora Pro — thank you for supporting Fixora
            {status?.licensedTo !== null && status !== null ? ` (${status.licensedTo})` : ''}.
          </span>
          <Button variant="ghost" size="sm" onClick={() => void deactivate()}>
            Remove
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <p className="max-w-md text-xs text-fg-muted">
            Fixora is free with your own key. A one-time{' '}
            <span className="text-fg-secondary">Supporter</span> license funds development and locks
            in early-supporter benefits. Purchase at{' '}
            <span className="text-fg-secondary">{PURCHASE_URL}</span>, then paste your key here.
          </p>
          <label htmlFor={keyId} className="text-sm text-fg">
            License key
          </label>
          <div className="flex items-center gap-2">
            <Input
              id={keyId}
              value={draft}
              placeholder="paste your license key"
              onChange={(e) => {
                setDraft(e.target.value);
              }}
              className="flex-1"
            />
            <Button
              size="sm"
              onClick={() => void activateNow()}
              disabled={busy || draft.trim().length === 0}
            >
              Activate
            </Button>
          </div>
          {error !== null && <span className="text-xs text-danger-text">{error}</span>}
        </div>
      )}
    </Group>
  );
}

function EditorSettings(): React.JSX.Element {
  const autoSave = useUiStore((s) => s.autoSave);
  const setAutoSave = useUiStore((s) => s.setAutoSave);
  const switchId = useId();

  return (
    <Group title="Editor">
      <div className="flex items-start justify-between gap-4">
        <label htmlFor={switchId} className="flex flex-col gap-0.5">
          <span className="text-sm text-fg">Auto save</span>
          <span className="max-w-md text-xs text-fg-muted">
            Off by default. When on, an edited file is written about a second after you stop typing.
            Fixora only ever writes files inside the open project, and a verified repair is still
            applied through its own reviewed flow.
          </span>
        </label>
        <Switch
          id={switchId}
          checked={autoSave}
          onCheckedChange={setAutoSave}
          aria-label="Auto save"
        />
      </div>
    </Group>
  );
}

function StartupSettings(): React.JSX.Element {
  const reopenLastProject = useUiStore((s) => s.reopenLastProject);
  const setReopenLastProject = useUiStore((s) => s.setReopenLastProject);
  const switchId = useId();

  return (
    <Group title="Startup">
      <div className="flex items-start justify-between gap-4">
        <label htmlFor={switchId} className="flex min-w-0 flex-col gap-0.5">
          <span className="text-sm text-fg">Reopen last project on startup</span>
          <span className="max-w-md text-xs text-fg-muted">
            Off by default. Fixora opens on the Home screen with a clean session — no problems,
            assistant history, or unfinished repair carried over from last time. Turning this on
            reopens the folder; analysis always runs fresh.
          </span>
        </label>
        <Switch
          id={switchId}
          checked={reopenLastProject}
          onCheckedChange={setReopenLastProject}
          aria-label="Reopen last project on startup"
        />
      </div>
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

/**
 * A labelled setting. Stacked (label above control) rather than label-left/control-right: this panel
 * is a resizable side pane, and a fixed-width control beside a label is exactly what clipped and
 * produced a horizontal scrollbar at narrow widths. Stacked + full-width controls never overflow.
 */
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
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-sm text-fg">
        {label}
      </label>
      {children}
    </div>
  );
}
