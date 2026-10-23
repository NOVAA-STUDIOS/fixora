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
import { useZapprStore } from '../../stores/zappr-store.js';
import { useEditorStore } from '../editor/editor-store.js';
import { useWorkspaceStore } from '../workspace/workspace-store.js';

import { useCommands } from './command-provider.js';
import { formatBinding } from './keybinding.js';
import { groupCommands } from './palette-model.js';
import { isCommandEnabled, type Command as CommandDef } from './registry.js';
import { formatZapprPaletteContext } from './zappr-palette-actions.js';

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
 * the cmdk-based Command primitive (arrow-key listbox a11y). Both of those are the
 * parts a hand-rolled palette gets subtly wrong, and both are surfaces axe scrutinises.
 */
export function CommandPalette(): React.JSX.Element {
  const open = useUiStore((s) => s.paletteOpen);
  const setOpen = useUiStore((s) => s.setPaletteOpen);
  const registry = useCommands();
  const [query, setQuery] = useState('');
  const contextLine = formatZapprPaletteContext({
    selectedCode: useZapprStore((s) => s.selectedCode),
    selectedCodeFile: useZapprStore((s) => s.selectedCodeFile),
    selectedCodeStartLine: useZapprStore((s) => s.selectedCodeStartLine),
    selectedCodeEndLine: useZapprStore((s) => s.selectedCodeEndLine),
    selectedWorkspaceRoot: useZapprStore((s) => s.selectedCodeWorkspaceRoot),
    workspaceRoot: useWorkspaceStore((s) => s.workspace?.rootPath ?? null),
    mentionFiles: useZapprStore((s) => s.mentionFiles),
    activeFile: useEditorStore((s) => s.activeTab),
  });

  // Query resets whenever the palette opens or closes — "clear on Escape or when palette closes"
  // covers the typed search text, not the persisted recent-commands list itself.
  useEffect(() => {
    setQuery('');
  }, [open]);

  // Computed each render (cheap for a handful of commands) so the list always reflects the
  // current registry — no memo to keep in sync with a mutable source.
  const all = registry.all();
  const searchTerms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const matchingCommands = searchTerms.length === 0
    ? all
    : all.filter((command) => {
        const searchText = `${command.title} ${(command.keywords ?? []).join(' ')}`.toLocaleLowerCase();
        return searchTerms.every((term) => searchText.includes(term));
      });
  const groups = groupCommands(matchingCommands);
  const byId = new Map(all.map((command) => [command.id, command]));
  const recent =
    query.trim() === ''
      ? readRecentIds()
          .map((id) => byId.get(id))
          .filter((command): command is CommandDef => command !== undefined)
      : [];

  const runCommand = (command: CommandDef): void => {
    if (!isCommandEnabled(command)) return;
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

        {contextLine !== null && (
          <p className="border-b border-border-subtle px-4 py-2 text-[11px] text-fg-muted" aria-label="Current Zappr context">
            {contextLine}
          </p>
        )}

        <Command loop shouldFilter={false}>
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
                    disabled={!isCommandEnabled(command)}
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
                    disabled={!isCommandEnabled(command)}
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
