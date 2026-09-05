import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Kbd,
} from '@fixora/ui';
import { useEffect, useState } from 'react';

import { useUiStore } from '../../stores/ui-store.js';

import { useCommands } from './command-provider.js';
import { formatBinding } from './keybinding.js';
import { groupCommands } from './palette-model.js';
import type { Command as CommandDef } from './registry.js';

const RECENT_KEY = 'fixora.recentCommands';
const MAX_RECENT = 5;

function readRecentIds(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

function recordRecentId(id: string): void {
  try {
    const next = [id, ...readRecentIds().filter((existing) => existing !== id)].slice(0, MAX_RECENT);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // localStorage unavailable (private mode, quota) — recent commands is a convenience, not
    // load-bearing, so this fails silently rather than breaking command execution.
  }
}

/**
 * The ⌘K palette. It is a *view* of the command registry — it renders whatever commands are
 * registered, grouped, and runs the one the user picks. It holds no command definitions of its
 * own; that is the registry's job, which is what keeps the palette and the keybindings in lockstep.
 *
 * The palette lives inside a Radix Dialog (focus trap, Escape, restore focus) and renders through
 * the cmdk-based Command primitive (filtering + arrow-key listbox a11y). Both of those are the
 * parts a hand-rolled palette gets subtly wrong, and both are surfaces axe scrutinises.
 */
export function CommandPalette(): React.JSX.Element {
  const open = useUiStore((s) => s.paletteOpen);
  const setOpen = useUiStore((s) => s.setPaletteOpen);
  const registry = useCommands();
  const [query, setQuery] = useState('');

  // Query resets whenever the palette opens or closes — "clear on Escape or when palette closes"
  // covers the typed search text, not the persisted recent-commands list itself.
  useEffect(() => {
    setQuery('');
  }, [open]);

  // Computed each render (cheap for a handful of commands) so the list always reflects the
  // current registry — no memo to keep in sync with a mutable source.
  const all = registry.all();
  const groups = groupCommands(all);
  const byId = new Map(all.map((command) => [command.id, command]));
  const recent =
    query.trim() === ''
      ? readRecentIds()
          .map((id) => byId.get(id))
          .filter((command): command is CommandDef => command !== undefined)
      : [];

  const runCommand = (command: CommandDef): void => {
    recordRecentId(command.id);
    command.run();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-xl overflow-hidden border-border-subtle/50 bg-[color-mix(in_srgb,var(--fx-color-bg-overlay)_85%,transparent)] p-0">
        {/* The dialog needs a name and description for screen readers; the palette's visible
            surface is the search box, so these are visually hidden but present. */}
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        <DialogDescription className="sr-only">
          Search for a command and press Enter to run it.
        </DialogDescription>

        <Command loop>
          <CommandInput
            placeholder="Type a command…"
            autoFocus
            value={query}
            onValueChange={setQuery}
            className="text-base"
          />
          <CommandList>
            <CommandEmpty>No matching command.</CommandEmpty>
            {recent.length > 0 && (
              <CommandGroup heading="Recent">
                {recent.map((command) => (
                  <CommandItem
                    key={`recent-${command.id}`}
                    value={`${command.title} ${(command.keywords ?? []).join(' ')}`}
                    onSelect={() => {
                      runCommand(command);
                    }}
                  >
                    <span className="flex-1 truncate">{command.title}</span>
                    {command.keybinding !== undefined && (
                      <Kbd className="ml-auto">{formatBinding(command.keybinding)}</Kbd>
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {groups.map(({ group, commands }) => (
              <CommandGroup key={group} heading={group}>
                {commands.map((command) => (
                  <CommandItem
                    key={command.id}
                    // cmdk matches on this value; include keywords so "spacing" finds density.
                    value={`${command.title} ${(command.keywords ?? []).join(' ')}`}
                    onSelect={() => {
                      runCommand(command);
                    }}
                  >
                    <span className="flex-1 truncate">{command.title}</span>
                    {command.keybinding !== undefined && (
                      <Kbd className="ml-auto">{formatBinding(command.keybinding)}</Kbd>
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
