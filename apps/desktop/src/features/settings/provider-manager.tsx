import type { ProviderInfo } from '@fixora/shared-types';
import { formatAgo, healthColour, statusLabel } from '@fixora/shared-types';
import { Button, Input, Switch, cn } from '@fixora/ui';
import { useEffect, useId, useState } from 'react';

import { invoke } from '../../lib/bridge.js';
import { useAiStore } from '../../stores/ai-store.js';

/**
 * The provider manager.
 *
 * The registry, the failover chain and the health store were all built, tested, and unreachable —
 * priority order and enable/disable existed only as functions nothing called. This panel is the
 * surface for them; it adds no selection logic of its own, and every mutation is main's decision
 * echoed back rather than local state the renderer maintains.
 *
 * Order is the failover chain, top first. That is the single most important thing to convey, so it
 * is stated as a numbered list with explicit move controls rather than drag-and-drop: a drag target
 * in a five-row list is fiddly, keyboard-hostile, and hides the ordering from anyone not currently
 * dragging.
 */

const DOT: Record<'green' | 'yellow' | 'red', string> = {
  green: 'bg-success-solid',
  yellow: 'bg-warn-solid',
  red: 'bg-danger-solid',
};

export function ProviderManager(): React.JSX.Element {
  const [providers, setProviders] = useState<ProviderInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  /** Every mutation returns the refreshed list, so this is the only place state is set. */
  async function apply(
    action: Promise<
      { ok: true; value: { providers: ProviderInfo[] } } | { ok: false; error: { message: string } }
    >,
  ): Promise<boolean> {
    const result = await action;
    if (result.ok) {
      setProviders(result.value.providers);
      setError(null);
      /**
       * Re-read the AI config, because "is AI set up?" just changed.
       *
       * `config.configured` is what the Problems panel reads to choose between Repair and "Set up AI
       * to repair", and it was only ever fetched on mount. Saving a key here updated the registry and
       * the credential store and left that flag stale, so a user who configured a provider in these
       * slots kept being told to set one up. The legacy field appeared to work only because it went
       * through `ai-store.setKey`, which refreshes the config as a side effect.
       */
      void useAiStore.getState().loadConfig();
    } else {
      // A failed write must not leave the list showing a change that did not happen.
      setError(result.error.message);
    }
    // Reported, not swallowed: the key field clears its input only when the save really landed.
    return result.ok;
  }

  useEffect(() => {
    void apply(invoke('providers:list', {}));
  }, []);

  if (providers === null) {
    return <p className="text-xs text-fg-muted">Loading providers…</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-[11px] leading-relaxed text-fg-muted">
        Fixora tries these in order, top first. If one is unavailable — rate limited, down, or a
        local daemon that is not running — it moves to the next enabled provider automatically. A
        rejected API key is never retried elsewhere.
      </p>

      {error !== null && (
        <p role="alert" className="text-[11px] text-danger-text">
          {error}
        </p>
      )}

      <ol className="flex flex-col gap-1.5" aria-label="Provider priority">
        {providers.map((provider, index) => (
          <li
            key={provider.id}
            className="flex flex-col gap-1 rounded-md border border-border-subtle bg-inset px-2.5 py-(--fx-card-padding-y)"
          >
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="shrink-0 font-mono text-[10px] tabular-nums text-fg-muted">
                {provider.priority}
              </span>
              <span className="min-w-0 truncate text-xs font-semibold text-fg">{provider.label}</span>

              {provider.local && (
                <span
                  className="shrink-0 rounded bg-success-subtle px-1 py-px text-[9px] font-medium text-success-text"
                  title="Runs on your machine. Your code never leaves the device."
                >
                  local
                </span>
              )}
              {/* Stated because an enabled provider with no key is silently skipped by the chain. */}
              {provider.requiresKey && !provider.hasKey && (
                <span className="shrink-0 rounded bg-warn-subtle px-1 py-px text-[9px] font-medium text-warn-text">
                  no key
                </span>
              )}

              <span className="ml-auto flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  aria-label={`Move ${provider.label} up`}
                  disabled={index === 0}
                  onClick={() => void apply(invoke('providers:moveUp', { id: provider.id }))}
                  className="rounded px-1.5 text-xs text-fg-secondary hover:bg-hover hover:text-fg disabled:opacity-30 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus-ring focus-visible:outline"
                >
                  ↑
                </button>
                <button
                  type="button"
                  aria-label={`Move ${provider.label} down`}
                  disabled={index === providers.length - 1}
                  onClick={() =>
                    void apply(invoke('providers:moveDown', { id: provider.id }))
                  }
                  className="rounded px-1.5 text-xs text-fg-secondary hover:bg-hover hover:text-fg disabled:opacity-30 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus-ring focus-visible:outline"
                >
                  ↓
                </button>
                <Switch
                  checked={provider.enabled}
                  aria-label={`Enable ${provider.label}`}
                  onCheckedChange={(enabled) =>
                    void apply(
                      invoke('providers:setEnabled', { id: provider.id, enabled }),
                    )
                  }
                />
              </span>
            </div>

            {/*
              Each provider gets its OWN key field. One shared field — labelled for a single vendor —
              is what made every provider after the first unusable: a key pasted for Gemini was saved
              into the OpenRouter slot, overwriting it, and Gemini stayed unreachable.
            */}
            {provider.requiresKey && (
              <ProviderKeyField
                provider={provider}
                onSave={(key) => apply(invoke('providers:setKey', { id: provider.id, key }))}
                onClear={() => apply(invoke('providers:clearKey', { id: provider.id }))}
              />
            )}

            {/*
              The model, EDITABLE. It was rendered as text here, and `providers:setModel` — the
              channel that writes it, and the one the orchestrator reads back — had no caller in the
              renderer at all. The only model control in Settings wrote the legacy single-provider
              store, which the chain does not consult, so changing a provider's model appeared to
              save and the next repair used the old one.
            */}
            <ProviderModelField
              provider={provider}
              onSave={(model) => apply(invoke('providers:setModel', { id: provider.id, model }))}
            />

            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-fg-muted">

              {/*
                Health, only when there is any. A provider nobody has exercised has none, and showing
                red for "never used" would be a fabricated verdict — so the row simply says so.
              */}
              {provider.health === null ? (
                <span className="ml-auto">not checked yet</span>
              ) : (
                <span className="ml-auto flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span className="flex items-center gap-1">
                    <span
                      aria-hidden="true"
                      className={cn('size-1.5 rounded-full', DOT[healthColour(provider.health.status)])}
                    />
                    <span>{statusLabel(provider.health.status)}</span>
                  </span>
                  {provider.health.latencyMs !== null && (
                    <span className="tabular-nums">{provider.health.latencyMs}ms</span>
                  )}
                  {provider.health.quotaRemaining !== null && (
                    <span className="tabular-nums">
                      {provider.health.quotaRemaining}
                      {provider.health.quotaLimit === null
                        ? ''
                        : `/${String(provider.health.quotaLimit)}`}{' '}
                      left
                    </span>
                  )}
                  {provider.health.lastSuccessAt !== null && (
                    <span>ok {formatAgo(provider.health.lastSuccessAt)}</span>
                  )}
                  {provider.health.lastFailureAt !== null && (
                    <span className="text-danger-text">
                      failed {formatAgo(provider.health.lastFailureAt)}
                    </span>
                  )}
                </span>
              )}
            </div>
          </li>
        ))}
      </ol>

      <Button
        variant="ghost"
        size="sm"
        className="self-start"
        onClick={() => void apply(invoke('providers:list', {}))}
      >
        Refresh
      </Button>
    </div>
  );
}

/**
 * One provider's key field.
 *
 * Shows the masked tail of what is stored rather than a bare "configured" tick, because the question
 * a user actually has when re-pasting is "is the key in there the one I think it is" — and two keys
 * for the same provider look identical to a checkmark.
 *
 * The input is emptied on save and never repopulated: the stored key is not readable by the renderer
 * by design, so showing anything in the box afterwards would be showing something that is not it.
 */
function ProviderKeyField({
  provider,
  onSave,
  onClear,
}: {
  provider: ProviderInfo;
  onSave: (key: string) => Promise<boolean>;
  onClear: () => Promise<unknown>;
}): React.JSX.Element {
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const inputId = useId();

  const save = async (): Promise<void> => {
    const key = draft.trim();
    if (key === '') return;
    setBusy(true);
    try {
      // Cleared on success only — a failed save must not lose what the user pasted, which for a
      // key copied from a page that shows it once is unrecoverable.
      if (await onSave(key)) setDraft('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <label htmlFor={inputId} className="sr-only">
        {provider.label} API key
      </label>
      <Input
        id={inputId}
        type="password"
        autoComplete="off"
        spellCheck={false}
        className="h-6 min-w-0 flex-1 text-[11px]"
        placeholder={provider.keyHint ?? `${provider.label} API key`}
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void save();
        }}
      />
      <Button
        size="sm"
        variant="secondary"
        className="shrink-0"
        disabled={busy || draft.trim() === ''}
        onClick={() => void save()}
      >
        Save
      </Button>
      {provider.hasKey && (
        <Button
          size="sm"
          variant="ghost"
          className="shrink-0"
          disabled={busy}
          onClick={() => void onClear()}
        >
          Remove
        </Button>
      )}
      {provider.keyUrl !== undefined && provider.keyHint === null && (
        <a
          href={provider.keyUrl}
          target="_blank"
          rel="noreferrer"
          className="shrink-0 text-[10px] text-accent-text hover:underline"
        >
          Get a key
        </a>
      )}
    </div>
  );
}

/**
 * A provider's model id.
 *
 * Free text rather than a dropdown: only OpenRouter publishes a catalogue Fixora can enumerate
 * (`discovery: 'catalogue'`), and offering a list for the others would either be empty or a hardcoded
 * guess that goes stale the week a vendor ships a new model. The id the user pastes from the
 * provider's own docs is authoritative; a wrong one comes back as a clear 404 naming it.
 *
 * Empty means "follow the descriptor default", which is what `(auto)` reports — so clearing the field
 * is how a user gets back to the shipped default after a vendor retires a model.
 */
function ProviderModelField({
  provider,
  onSave,
}: {
  provider: ProviderInfo;
  onSave: (model: string) => Promise<boolean>;
}): React.JSX.Element {
  const inputId = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Null means "not being edited": the field shows what main last returned, so an edit elsewhere is
  // reflected rather than shadowed by stale local state.
  const value = draft ?? (provider.modelIsAuto ? '' : provider.model);
  const dirty = draft !== null && draft !== (provider.modelIsAuto ? '' : provider.model);

  const save = async (): Promise<void> => {
    if (!dirty) return;
    setBusy(true);
    try {
      if (await onSave(draft.trim())) setDraft(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <label htmlFor={inputId} className="sr-only">
        {provider.label} model
      </label>
      <Input
        id={inputId}
        spellCheck={false}
        className="h-6 min-w-0 flex-1 font-mono text-[11px]"
        placeholder={provider.model}
        value={value}
        onChange={(e) => {
          setDraft(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void save();
        }}
      />
      <Button
        size="sm"
        variant="secondary"
        className="shrink-0"
        disabled={busy || !dirty}
        onClick={() => void save()}
      >
        Set model
      </Button>
    </div>
  );
}
