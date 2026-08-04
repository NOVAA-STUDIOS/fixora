import type { ProviderInfo } from '@fixora/shared-types';
import { formatAgo, healthColour, statusLabel } from '@fixora/shared-types';
import { Button, Switch, cn } from '@fixora/ui';
import { useEffect, useState } from 'react';

import { invoke } from '../../lib/bridge.js';

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
  ): Promise<void> {
    const result = await action;
    if (result.ok) {
      setProviders(result.value.providers);
      setError(null);
    } else {
      // A failed write must not leave the list showing a change that did not happen.
      setError(result.error.message);
    }
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

            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-fg-muted">
              <span className="min-w-0 truncate font-mono">{provider.model}</span>
              {provider.modelIsAuto && <span>(auto)</span>}

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
