/**
 * The command registry (TDD §8.4): "not a component — a subsystem. Every action registers
 * `{ id, title, keybinding, predicate, run }`. From that one registry we derive the ⌘K palette,
 * the menu bar, and all keyboard shortcuts."
 *
 * The whole point is that there is exactly **one** list. A feature adds a command; the palette
 * and the shortcut come free and cannot drift out of sync, because there is nowhere for a second
 * copy to live.
 */

export type Command = {
  /** Stable, namespaced id: `view.toggleTheme`, `palette.open`. Used as the React key and telemetry key. */
  id: string;
  title: string;
  /** Optional grouping for the palette ("View", "Workspace"). */
  group?: string;
  /**
   * A keybinding in a normalised form: `mod+k`, `mod+shift+p`, `escape`. `mod` is ⌘ on macOS and
   * Ctrl elsewhere, resolved at match time — one binding string, correct on every platform.
   */
  keybinding?: string;
  /** Extra words the palette should match on, beyond the title. */
  keywords?: string[];
  /** When false, the command is hidden from the palette and its keybinding is inert. */
  enabled?: (() => boolean) | undefined;
  run: () => void;
};

export type CommandRegistry = {
  register: (command: Command) => () => void;
  all: () => Command[];
  get: (id: string) => Command | undefined;
};

export function createCommandRegistry(): CommandRegistry {
  const commands = new Map<string, Command>();

  return {
    register(command) {
      if (commands.has(command.id)) {
        throw new Error(`Command registered twice: ${command.id}`);
      }
      commands.set(command.id, command);
      return () => {
        commands.delete(command.id);
      };
    },
    all() {
      return [...commands.values()];
    },
    get(id) {
      return commands.get(id);
    },
  };
}

export function isCommandEnabled(command: Command): boolean {
  return command.enabled?.() ?? true;
}
