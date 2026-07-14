import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';

import { matchesBinding } from './keybinding.js';
import {
  createCommandRegistry,
  isCommandEnabled,
  type Command,
  type CommandRegistry,
} from './registry.js';

const CommandContext = createContext<CommandRegistry | null>(null);

/**
 * Holds the one command registry and runs the single global keybinding listener. **Both the
 * palette and the keybindings read from this same registry** — that is the M1 thesis (TDD §8.4)
 * made literal: there is one list, so a shortcut and its palette entry cannot disagree, because
 * there is nowhere for a second copy to live.
 *
 * The listener ignores keystrokes that originate in a text field (unless the binding uses `mod`),
 * so typing "k" in an input does not fire a bare-key command. It runs at capture on `document`,
 * so a command works regardless of what has focus — the shell must be operable from anywhere.
 */
export function CommandProvider({
  commands,
  children,
}: {
  commands: Command[];
  children: ReactNode;
}): React.JSX.Element {
  const registry = useMemo(() => createCommandRegistry(), []);

  useEffect(() => {
    const unregisters = commands.map((c) => registry.register(c));
    return () => {
      for (const off of unregisters) off();
    };
  }, [commands, registry]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target;
      const inEditable =
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT');

      // Read the registry — the same source the palette renders from. The registry is a stable
      // ref, so this effect never re-subscribes; `all()` returns the current registrations at
      // event time.
      for (const command of registry.all()) {
        if (command.keybinding === undefined) continue;
        if (!matchesBinding(event, command.keybinding)) continue;

        // A bare-key binding must not steal a keystroke the user is typing into a field. A
        // `mod`-based binding (⌘K) is a deliberate chord and fires anywhere.
        if (inEditable && !command.keybinding.includes('mod')) continue;
        if (!isCommandEnabled(command)) continue;

        event.preventDefault();
        command.run();
        return;
      }
    };

    document.addEventListener('keydown', onKeyDown, { capture: true });
    return () => {
      document.removeEventListener('keydown', onKeyDown, { capture: true });
    };
  }, [registry]);

  return <CommandContext.Provider value={registry}>{children}</CommandContext.Provider>;
}

export function useCommands(): CommandRegistry {
  const registry = useContext(CommandContext);
  if (registry === null) {
    throw new Error('useCommands must be used inside a CommandProvider');
  }
  return registry;
}
