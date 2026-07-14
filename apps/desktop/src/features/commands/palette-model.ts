import { isCommandEnabled, type Command } from './registry.js';

export type CommandGroup = { group: string; commands: Command[] };

/**
 * Turn the flat registry into the grouped, filtered list the palette renders — the pure part of
 * "the palette is a view of the registry", extracted so it can be tested without mounting cmdk
 * (whose filtering needs real layout the test environment does not provide). Enabled-only, and
 * group order is first-seen so the registry author controls it.
 */
export function groupCommands(commands: Command[]): CommandGroup[] {
  const byGroup = new Map<string, Command[]>();
  for (const command of commands) {
    if (!isCommandEnabled(command)) continue;
    const key = command.group ?? 'Commands';
    const list = byGroup.get(key) ?? [];
    list.push(command);
    byGroup.set(key, list);
  }
  return [...byGroup.entries()].map(([group, cmds]) => ({ group, commands: cmds }));
}
