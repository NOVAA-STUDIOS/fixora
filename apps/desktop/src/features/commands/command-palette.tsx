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

import { useUiStore } from '../../stores/ui-store.js';

import { useCommands } from './command-provider.js';
import { formatBinding } from './keybinding.js';
import { groupCommands } from './palette-model.js';

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

  // Computed each render (cheap for a handful of commands) so the list always reflects the
  // current registry — no memo to keep in sync with a mutable source.
  const groups = groupCommands(registry.all());

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-xl overflow-hidden p-0">
        {/* The dialog needs a name and description for screen readers; the palette's visible
            surface is the search box, so these are visually hidden but present. */}
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        <DialogDescription className="sr-only">
          Search for a command and press Enter to run it.
        </DialogDescription>

        <Command loop>
          <CommandInput placeholder="Type a command…" autoFocus />
          <CommandList>
            <CommandEmpty>No matching command.</CommandEmpty>
            {groups.map(({ group, commands }) => (
              <CommandGroup key={group} heading={group}>
                {commands.map((command) => (
                  <CommandItem
                    key={command.id}
                    // cmdk matches on this value; include keywords so "spacing" finds density.
                    value={`${command.title} ${(command.keywords ?? []).join(' ')}`}
                    onSelect={() => {
                      command.run();
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
