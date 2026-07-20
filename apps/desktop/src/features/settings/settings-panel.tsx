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
    // flex-1 + min-w-0: this is now a top-level child of the shell's flex row, and a flex item sizes
    // to its content by default — without this the whole settings page shrank to its column width
    // and sat against the activity rail with dead space beside it.
    <section
      aria-label="Settings"
      className="flex h-full min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-border-subtle bg-raised"
    >
      <header className="flex h-11 shrink-0 items-center border-b border-border-subtle px-6">
        <h2 className="text-sm font-semibold text-fg">Settings</h2>
      </header>
      {/* The scroll lives on the content, not on the section, so the header stays pinned. The inner
          column is capped at a reading width and centred: settings copy is prose, and prose set the
          full width of a 1440px window is as hard to read as prose set 180px wide. */}
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-10 px-6 py-8">
          <AppearanceSettings />
          <EditorSettings />
          <StartupSettings />
          <AiSettings />
          <LicenseSettings />
          <PrivacySettings />
          <Keybindings />
        </div>
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
      <Field
        label="Theme"
        htmlFor={themeId}
        description="Fixora follows this for its own chrome and the editor."
      >
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
      <Field
        label="Density"
        htmlFor={densityId}
        description="Compact tightens row heights and controls throughout the app."
      >
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
      <p className="text-xs leading-relaxed text-fg-muted">
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
          <p className="min-w-0 text-xs leading-relaxed text-fg-secondary [overflow-wrap:anywhere]">
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

      <Field
        label="Model"
        htmlFor={modelId}
        description="Free models are listed first, so trying the beta costs nothing."
      >
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
        <p className="text-xs text-warn-text">{models.notice}</p>
      )}

      {configured ? (
        <div className="flex items-center justify-between gap-4">
          <span className="min-w-0 truncate text-sm text-fg">
            Key configured <span className="text-fg-muted">({config?.keyHint ?? '••••'})</span>
          </span>
          <Button variant="ghost" size="sm" className="shrink-0" onClick={() => void clearKey()}>
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
              // min-w-0: an input is a flex item with an intrinsic minimum width, so `flex-1` alone
              // will not let it shrink and it pushes the button out of a narrow pane instead.
              className="min-w-0 flex-1"
            />
            <Button
              size="sm"
              className="shrink-0"
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
          <span className="min-w-0 text-sm text-fg [overflow-wrap:anywhere]">
            Fixora Pro — thank you for supporting Fixora
            {status?.licensedTo !== null && status !== null ? ` (${status.licensedTo})` : ''}.
          </span>
          <Button variant="ghost" size="sm" className="shrink-0" onClick={() => void deactivate()}>
            Remove
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <p className="text-xs leading-relaxed text-fg-muted">
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
              className="min-w-0 flex-1"
            />
            <Button
              size="sm"
              className="shrink-0"
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
      <ToggleField
        label="Auto save"
        htmlFor={switchId}
        description="Off by default. When on, an edited file is written about a second after you stop typing. Fixora only ever writes files inside the open project, and a verified repair is still applied through its own reviewed flow."
        checked={autoSave}
        onCheckedChange={setAutoSave}
      />
    </Group>
  );
}

function StartupSettings(): React.JSX.Element {
  const reopenLastProject = useUiStore((s) => s.reopenLastProject);
  const setReopenLastProject = useUiStore((s) => s.setReopenLastProject);
  const switchId = useId();

  return (
    <Group title="Startup">
      <ToggleField
        label="Reopen last project on startup"
        htmlFor={switchId}
        description="Off by default. Fixora opens on the Home screen with a clean session — no problems, assistant history, or unfinished repair carried over from last time. Turning this on reopens the folder; analysis always runs fresh."
        checked={reopenLastProject}
        onCheckedChange={setReopenLastProject}
      />
    </Group>
  );
}

function PrivacySettings(): React.JSX.Element {
  const telemetryEnabled = useUiStore((s) => s.telemetryEnabled);
  const setTelemetryEnabled = useUiStore((s) => s.setTelemetryEnabled);
  const switchId = useId();

  return (
    <Group title="Privacy">
      <ToggleField
        label="Anonymous usage telemetry"
        htmlFor={switchId}
        description={
          'Off by default. If enabled, Fixora sends anonymous, event-level counts (like “a fix was applied”) — never your code, file names, or repository identity.'
        }
        checked={telemetryEnabled}
        onCheckedChange={setTelemetryEnabled}
      />
    </Group>
  );
}

function Keybindings(): React.JSX.Element {
  const registry = useCommands();
  const commands = registry.all().filter((c) => c.keybinding !== undefined);

  return (
    <Group title="Keyboard shortcuts">
      <ul className="flex flex-col divide-y divide-border-subtle overflow-hidden rounded-lg border border-border-subtle bg-inset">
        {commands.map((command) => (
          <li
            key={command.id}
            className="flex items-center justify-between gap-3 px-3 py-2 text-sm transition-colors duration-(--fx-motion-duration-fast) hover:bg-hover"
          >
            <span className="min-w-0 truncate text-fg-secondary">{command.title}</span>
            {command.keybinding !== undefined && (
              <Kbd className="shrink-0">{formatBinding(command.keybinding)}</Kbd>
            )}
          </li>
        ))}
      </ul>
    </Group>
  );
}

/**
 * A settings section. The heading is a real heading now — sentence case at the body size, with a
 * rule under it — rather than a 12px uppercase micro-label. Uppercase tracking-wide text is a
 * *label* style; using it for every section heading left the page with no typographic hierarchy at
 * all, because the headings were smaller and quieter than the settings they introduced.
 */
function Group({
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
 * A labelled setting: label and explanation on the left, control on the right.
 *
 * The old layout stacked them, because the panel was 220px wide and a control beside a label
 * clipped. Now that settings owns the workbench there is room for the arrangement every desktop
 * settings screen uses — the eye scans the left column for the setting it wants and the right
 * column for its current value, instead of reading a single ribbon top to bottom.
 */
function Field({
  label,
  htmlFor,
  description,
  children,
}: {
  label: string;
  htmlFor: string;
  description?: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-8">
      <div className="flex min-w-0 flex-col gap-0.5">
        <label htmlFor={htmlFor} className="text-sm font-medium text-fg">
          {label}
        </label>
        {description !== undefined && (
          <p className="text-xs leading-relaxed text-fg-muted">{description}</p>
        )}
      </div>
      <div className="w-full shrink-0 sm:w-56">{children}</div>
    </div>
  );
}

/**
 * A boolean setting. Identical skeleton to `Field` so a toggle row and a select row share one
 * baseline grid — the three switch sections previously each hand-rolled their own flex layout and
 * drifted apart in gap and alignment.
 */
function ToggleField({
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
