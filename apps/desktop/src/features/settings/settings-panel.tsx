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

import { invoke } from '../../lib/bridge.js';
import { useAiStore } from '../../stores/ai-store.js';
import { isPro, useLicenseStore } from '../../stores/license-store.js';
import { useUiStore } from '../../stores/ui-store.js';
import { useCommands } from '../commands/command-provider.js';
import { formatBinding } from '../commands/keybinding.js';

import { detectProvider, normaliseKey } from './detect-provider.js';
import { ModelPicker } from './model-picker.js';
import { ProviderManager } from './provider-manager.js';

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
      {/* `relative` is load-bearing, not decoration. Tailwind's `sr-only` is `position: absolute`
          with no offsets, so a visually-hidden label resolves against the nearest POSITIONED
          ancestor — and with none, that is the initial containing block. The six per-provider key
          labels then sat at document coordinates up to 1504px, escaping both this scroller and the
          shell's `overflow-hidden`, and gave the whole window 736px of blank scroll below the UI. */}
      <div className="relative min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-10 px-6 py-8">
          <AppearanceSettings />
          <EditorSettings />
          <StartupSettings />
          <PerformanceSettings />
          <AiSettings />
          <ProviderSettings />
          <LicenseSettings />
          <PrivacySettings />
          <Keybindings />
          <LegalLinks />
        </div>
      </div>
    </section>
  );
}

/**
 * The published Terms and Privacy Policy.
 *
 * Plain anchors with target=_blank: main's `setWindowOpenHandler` routes those through the guarded
 * `openExternal` (navigation-guard.ts), so they open in the real browser and cannot navigate the app
 * window. No IPC channel is needed, and adding one would be a second, less-guarded path to the same
 * capability.
 */
const TERMS_URL = 'https://novaa-studios.github.io/fixora/terms.html';
const PRIVACY_URL = 'https://novaa-studios.github.io/fixora/privacy.html';

function LegalLinks(): React.JSX.Element {
  return (
    <div className="flex items-center gap-3 border-t border-border-subtle pt-6 text-xs text-fg-muted">
      <a
        href={TERMS_URL}
        target="_blank"
        rel="noreferrer noopener"
        className="text-accent-text hover:underline"
      >
        Terms of Service
      </a>
      <span aria-hidden="true">·</span>
      <a
        href={PRIVACY_URL}
        target="_blank"
        rel="noreferrer noopener"
        className="text-accent-text hover:underline"
      >
        Privacy Policy
      </a>
    </div>
  );
}

function AppearanceSettings(): React.JSX.Element {
  const theme = useUiStore((s) => s.theme);
  const density = useUiStore((s) => s.density);
  const editorTheme = useUiStore((s) => s.editorTheme);
  const minimapEnabled = useUiStore((s) => s.minimapEnabled);
  const setTheme = useUiStore((s) => s.setTheme);
  const setDensity = useUiStore((s) => s.setDensity);
  const setEditorTheme = useUiStore((s) => s.setEditorTheme);
  const setMinimapEnabled = useUiStore((s) => s.setMinimapEnabled);
  const themeId = useId();
  const densityId = useId();
  const editorThemeId = useId();
  const minimapId = useId();

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
      <Field
        label="Editor theme"
        htmlFor={editorThemeId}
        description="The code editor's own colour theme, independent of the app theme above."
      >
        <Select
          value={editorTheme}
          onValueChange={(v) => {
            setEditorTheme(v as typeof editorTheme);
          }}
        >
          <SelectTrigger id={editorThemeId} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="fixora">Fixora (follows app theme)</SelectItem>
            <SelectItem value="monokai">Monokai</SelectItem>
            <SelectItem value="solarized-dark">Solarized Dark</SelectItem>
          </SelectContent>
        </Select>
      </Field>
      <ToggleField
        label="Minimap"
        htmlFor={minimapId}
        description="On by default. The code overview on the editor's right edge; also hidden automatically in a narrow pane regardless of this."
        checked={minimapEnabled}
        onCheckedChange={setMinimapEnabled}
      />
    </Group>
  );
}

/**
 * Provider priority and health.
 *
 * A separate group from the key/model settings above on purpose: that group is about ONE provider's
 * credential, this one is about which providers exist and in what order they are tried. Merging them
 * was what made the failover chain invisible — the panel looked single-provider because it was.
 */
function ProviderSettings(): React.JSX.Element {
  return (
    <Group title="AI providers & failover">
      <ProviderManager />
    </Group>
  );
}

function AiSettings(): React.JSX.Element {
  const config = useAiStore((s) => s.config);
  const loadConfig = useAiStore((s) => s.loadConfig);
  const setModel = useAiStore((s) => s.setModel);
  const models = useAiStore((s) => s.models);
  const loadModels = useAiStore((s) => s.loadModels);
  const dismissMigrationNotice = useAiStore((s) => s.dismissMigrationNotice);

  const modelId = useId();

  useEffect(() => {
    void loadConfig();
    void loadModels();
  }, [loadConfig, loadModels]);

  const model = config?.model ?? '';

  // Only models OpenRouter currently offers. A retired id is not in this list, so it cannot be
  // picked again — and free ones sort first so the zero-cost path is the obvious one.
  const modelOptions = [...(models?.models ?? [])].sort((a, b) => {
    if (a.free !== b.free) return a.free ? -1 : 1;
    if (a.codeCapable !== b.codeCapable) return a.codeCapable ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

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
        <ModelPicker
          id={modelId}
          value={model}
          options={modelOptions}
          loading={models === null}
          onChange={(v) => {
            void setModel(v);
          }}
        />
      </Field>

      {/* What the selected model can actually do, read from provider metadata. Shown here so a user
          learns a limitation while CHOOSING a model, not after pressing Repair on a finding. */}
      {config?.capabilities !== null && config?.capabilities !== undefined && (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <CapabilityBadge
              label="Analyze"
              supported
              reason="Deterministic — no model required."
            />
            <CapabilityBadge
              label="Explain"
              supported={config.capabilities.profiles['explain']?.supported ?? true}
              reason={config.capabilities.profiles['explain']?.reason ?? ''}
            />
            <CapabilityBadge
              label="Repair"
              supported={config.capabilities.profiles['repair']?.supported ?? false}
              reason={config.capabilities.profiles['repair']?.reason ?? ''}
            />
            <CapabilityBadge
              label="Test"
              supported={config.capabilities.profiles['test']?.supported ?? false}
              reason={config.capabilities.profiles['test']?.reason ?? ''}
            />
          </div>
          {config.capabilities.profiles['repair']?.supported === false && (
            <div className="flex flex-col gap-2 rounded-md border border-warn-border bg-warn-subtle/30 px-3 py-2.5">
              <p className="text-xs leading-relaxed text-fg-secondary">
                <span className="font-semibold text-fg">Repair will not work on this model.</span>{' '}
                {config.capabilities.profiles['repair'].reason}
              </p>
              {config.suggestedModel !== null && (
                <Button
                  variant="primary"
                  size="sm"
                  className="self-start"
                  onClick={() => void setModel(config.suggestedModel?.id ?? '')}
                >
                  Switch to {config.suggestedModel.name}
                  {config.suggestedModel.free ? ' (free)' : ''}
                </Button>
              )}
            </div>
          )}
        </div>
      )}

      {models?.notice !== null && models?.notice !== undefined && (
        <p className="text-xs text-warn-text">{models.notice}</p>
      )}

      <PrimaryKeyField />
    </Group>
  );
}

/**
 * The primary key field: paste any provider's key and it files itself.
 *
 * This slot used to be "OpenRouter API key", wired to the legacy single-key store — the reason a
 * Gemini key pasted here ended up in the OpenRouter slot and was rejected by a provider it was never
 * issued for. It now reads the key's own prefix, writes it to the matching provider, enables that
 * provider and moves it to the head of the chain.
 *
 * It REFUSES an unrecognised key rather than guessing. Filing it under a default would produce a 401
 * from a provider the user never chose, which is a worse outcome than being told plainly that the
 * key was not recognised and the named slots below are the way in.
 *
 * The per-provider slots below are unchanged and remain the explicit path: saving there is about one
 * named provider and never reorders the chain.
 */
export function PrimaryKeyField(): React.JSX.Element {
  const loadConfig = useAiStore((s) => s.loadConfig);
  const inputId = useId();
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Normalised, not merely trimmed — and the SAVED value is this one. Detecting a key and then
  // storing the raw paste would send the invisible character to the provider, which answers 401 and
  // sends the user hunting for a problem with their key rather than with the space in front of it.
  const trimmed = normaliseKey(draft);
  // Detected on every keystroke, so the confirmation appears while pasting rather than after Save.
  const detected = trimmed === '' ? null : detectProvider(trimmed);

  const save = async (): Promise<void> => {
    if (detected === null) return;
    setSaving(true);
    setError(null);
    const result = await invoke('providers:setKey', {
      id: detected.id,
      key: trimmed,
      makePrimary: true,
    });
    setSaving(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    // Cleared on success only — a failed save must not lose a key the user may not be able to re-copy.
    setDraft('');
    // "Is AI set up?" just changed, and the Problems panel reads it from the config.
    void loadConfig();
  };

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={inputId} className="text-sm text-fg">
        Primary API key
      </label>
      <div className="flex items-center gap-2">
        <Input
          id={inputId}
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder="Paste a key from any provider"
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void save();
          }}
          // min-w-0: an input is a flex item with an intrinsic minimum width, so `flex-1` alone will
          // not let it shrink and it pushes the button out of a narrow pane instead.
          className="min-w-0 flex-1"
        />
        <Button
          size="sm"
          className="shrink-0"
          onClick={() => void save()}
          disabled={saving || detected === null}
        >
          Save
        </Button>
      </div>

      {/* Detection feedback, before Save rather than after: the user should be able to see the key
          landed in the right place while they can still change their mind about it. */}
      {detected !== null && (
        <p className="flex items-center gap-1.5 text-xs text-success-text">
          <span aria-hidden="true">✓</span>
          Detected <span className="font-medium">{detected.label}</span> — saving will make it your
          primary provider.
        </p>
      )}
      {trimmed !== '' && detected === null && (
        <p className="text-xs text-warn-text">Unknown provider — use slots below.</p>
      )}
      {error !== null && <span className="text-xs text-danger-text">{error}</span>}
    </div>
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
      // The IPC call itself failed, so we genuinely do not know why — say that plainly and name the
      // one thing worth checking, rather than a generic sentence that leaves the user with no move.
      setError(
        'Fixora could not complete the activation. Check that the key was pasted in full, then try again — nothing was changed.',
      );
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
  const formatOnSave = useUiStore((s) => s.formatOnSave);
  const setFormatOnSave = useUiStore((s) => s.setFormatOnSave);
  const autoSaveId = useId();
  const formatOnSaveId = useId();

  return (
    <Group title="Editor">
      <ToggleField
        label="Auto save"
        htmlFor={autoSaveId}
        description="Off by default. When on, an edited file is written about a second after you stop typing. Fixora only ever writes files inside the open project, and a verified repair is still applied through its own reviewed flow."
        checked={autoSave}
        onCheckedChange={setAutoSave}
      />
      <ToggleField
        label="Format on save"
        htmlFor={formatOnSaveId}
        description="On by default. Runs the project's own formatter (Prettier for JS/TS/CSS/etc., Ruff for Python) on a file after you save it — only when one is available; a project with no formatter configured is left exactly as you wrote it."
        checked={formatOnSave}
        onCheckedChange={setFormatOnSave}
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

/**
 * GPU compositing (Windows only). Main decides this per-machine on its own — a launch that never
 * paints is auto-detected and disables compositing from the next launch on — so this toggle is a
 * manual override for the case that doesn't self-detect: a driver that renders nothing usable on
 * screen but doesn't crash or hang either. Main-owned state (it has to be set before the GPU
 * process starts, long before any renderer preference could reach it), so this fetches/writes over
 * IPC rather than through the ui-store like every other toggle on this page.
 */
function PerformanceSettings(): React.JSX.Element | null {
  const [state, setState] = useState<{ disableCompositing: boolean } | null>(null);
  const [supported, setSupported] = useState(true);
  const switchId = useId();

  useEffect(() => {
    void invoke('system:getGpuPreference', {}).then((r) => {
      if (!r.ok) return;
      setSupported(r.value.platformSupported);
      setState({ disableCompositing: r.value.disableCompositing });
    });
  }, []);

  if (!supported || state === null) return null;

  return (
    <Group title="Performance">
      <ToggleField
        label="Disable GPU compositing"
        htmlFor={switchId}
        description="Off by default. Fixora already detects and works around a black-screen-on-launch driver bug automatically. Turn this on only if you still see a black window on startup — it trades smoother scrolling and animations for compatibility. Takes effect after restart."
        checked={state.disableCompositing}
        onCheckedChange={(v) => {
          setState({ disableCompositing: v });
          void invoke('system:setGpuCompositingDisabled', { disabled: v });
        }}
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

/**
 * One capability, stated plainly. Green means the provider says the model supports it; the muted
 * state is not a failure, it is a fact about the model — so it reads as information, not an alarm.
 */
function CapabilityBadge({
  label,
  supported,
  reason,
}: {
  label: string;
  supported: boolean;
  reason: string;
}): React.JSX.Element {
  return (
    <span
      title={supported ? `${label}: supported` : reason}
      className={
        supported
          ? 'flex items-center gap-1 rounded-full bg-success-subtle px-2 py-0.5 text-[10px] font-medium text-success-text'
          : 'flex items-center gap-1 rounded-full bg-inset px-2 py-0.5 text-[10px] font-medium text-fg-muted ring-1 ring-border-subtle ring-inset'
      }
    >
      <span aria-hidden="true">{supported ? '✓' : '✗'}</span>
      {label}
    </span>
  );
}
