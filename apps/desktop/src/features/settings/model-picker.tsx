import type { AiModelOption } from '@fixora/shared-types';
import {
  CheckIcon,
  ChevronDownIcon,
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  Popover,
  PopoverContent,
  PopoverTrigger,
  cn,
} from '@fixora/ui';
import { useMemo, useState } from 'react';

/**
 * The model picker.
 *
 * A `<Select>` was the wrong primitive for this and it showed. A select popup is trigger-width by
 * contract, and the trigger lives in a settings row — so a catalogue of ~80 entries with names like
 * "Anthropic: Claude Sonnet 4.5" was rendered into ~220px and every single one truncated. The
 * control that is supposed to help you choose a model made it impossible to read one.
 *
 * So this is a combobox instead, which is what a long, searchable, structured list actually needs:
 *
 *  - The popup sizes to its content up to a cap, independent of the trigger. Names fit.
 *  - Provider and model are separated. "Anthropic: Claude Sonnet 4.5" is one string from the API,
 *    but it is two facts, and splitting them lets the eye scan a column of providers.
 *  - Search, because a list of eighty needs it and scroll-hunting is not a selection mechanism.
 *  - "Free" is a badge, not three characters appended to a name that was already too long.
 *
 * This is the Raycast/Cursor model-switcher shape, and it is the same reason both of them use it.
 */
export function ModelPicker({
  value,
  options,
  loading,
  onChange,
  id,
}: {
  value: string;
  options: readonly AiModelOption[];
  loading: boolean;
  onChange: (id: string) => void;
  id?: string;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const selected = options.find((m) => m.id === value) ?? null;

  // Grouped by provider, free first. `split(': ')` is the shape OpenRouter uses for every entry;
  // anything without it falls back to a single "Other" group rather than being dropped.
  const groups = useMemo(() => {
    const byProvider = new Map<string, AiModelOption[]>();
    for (const m of options) {
      const provider = m.name.includes(':') ? (m.name.split(':')[0] ?? '').trim() : 'Other';
      const list = byProvider.get(provider) ?? [];
      list.push(m);
      byProvider.set(provider, list);
    }
    return [...byProvider.entries()]
      .map(([provider, models]) => ({
        provider,
        models: models.sort((a, b) => (a.free === b.free ? 0 : a.free ? -1 : 1)),
        hasFree: models.some((m) => m.free),
      }))
      .sort((a, b) =>
        a.hasFree === b.hasFree ? a.provider.localeCompare(b.provider) : a.hasFree ? -1 : 1,
      );
  }, [options]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          id={id}
          type="button"
          role="combobox"
          aria-expanded={open}
          disabled={loading && options.length === 0}
          className={cn(
            'flex h-(--fx-control-height-md) w-full items-center justify-between gap-2 rounded-md px-3',
            'border border-border-strong bg-inset text-sm text-fg',
            'transition-colors duration-(--fx-motion-duration-fast) ease-(--ease-entrance)',
            'hover:border-accent-border disabled:cursor-not-allowed disabled:opacity-50',
            'focus-visible:border-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring focus-visible:outline',
          )}
        >
          <span className="flex min-w-0 items-center gap-2">
            {selected === null ? (
              <span className="truncate text-fg-muted">
                {loading ? 'Loading models…' : 'Select a model'}
              </span>
            ) : (
              <>
                <span className="truncate">{modelName(selected.name)}</span>
                {selected.free && <FreeBadge />}
              </>
            )}
          </span>
          <ChevronDownIcon
            className={cn(
              'size-4 shrink-0 text-fg-muted transition-transform duration-(--fx-motion-duration-fast)',
              open && 'rotate-180',
            )}
          />
        </button>
      </PopoverTrigger>

      <PopoverContent
        align="end"
        className={cn(
          // Sized to content up to a cap, and never past the window — the whole point of moving
          // off Select. min-w keeps a short list from collapsing to a sliver.
          'w-[min(30rem,calc(100vw-3rem))] min-w-72',
        )}
      >
        <Command loop>
          {/* CommandInput draws its own search icon and bottom divider — wrapping it in another
              row was how the field ended up with two magnifying glasses side by side. */}
          <CommandInput placeholder="Search models…" autoFocus />
          <CommandList className="max-h-[22rem] p-1.5">
            <CommandEmpty>No model matches that.</CommandEmpty>
            {groups.map(({ provider, models }) => (
              <CommandGroup key={provider} heading={provider}>
                {models.map((m) => (
                  <CommandItem
                    key={m.id}
                    value={`${m.name} ${m.id}`}
                    onSelect={() => {
                      onChange(m.id);
                      setOpen(false);
                    }}
                    className="h-auto items-start gap-3 px-2.5 py-2"
                  >
                    {/* The check occupies its column whether or not it is showing, so rows do
                          not shift horizontally as the selection moves. */}
                    <span className="flex w-4 shrink-0 justify-center pt-0.5">
                      {m.id === value && <CheckIcon className="size-4 text-accent-text" />}
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="truncate font-medium text-fg">{modelName(m.name)}</span>
                        {m.free && <FreeBadge />}
                        {m.codeCapable && (
                          <span className="shrink-0 rounded px-1.5 py-px text-[10px] font-medium text-fg-muted ring-1 ring-border-strong ring-inset">
                            code
                          </span>
                        )}
                      </span>
                      {/* The id is what actually goes to the provider, so it stays visible —
                            quietly, in mono, where it reads as a machine value rather than a name. */}
                      <span className="truncate font-mono text-[11px] text-fg-muted">{m.id}</span>
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function FreeBadge(): React.JSX.Element {
  return (
    <span className="shrink-0 rounded bg-success-subtle px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-success-text">
      Free
    </span>
  );
}

/** "Anthropic: Claude Sonnet 4.5" → "Claude Sonnet 4.5". The provider is the group heading. */
function modelName(full: string): string {
  const i = full.indexOf(':');
  return i === -1 ? full : full.slice(i + 1).trim();
}
