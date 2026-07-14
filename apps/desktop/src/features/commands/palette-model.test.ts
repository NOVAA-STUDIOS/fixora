import { describe, expect, it } from 'vitest';

import { groupCommands } from './palette-model.js';
import type { Command } from './registry.js';

const cmd = (id: string, group?: string, enabled?: () => boolean): Command => {
  const command: Command = { id, title: id, run: () => {} };
  if (group !== undefined) command.group = group;
  if (enabled !== undefined) command.enabled = enabled;
  return command;
};

describe('groupCommands (the palette is a view of the registry)', () => {
  it('groups by group, preserving first-seen order', () => {
    const groups = groupCommands([cmd('a', 'View'), cmd('b', 'Go to'), cmd('c', 'View')]);
    expect(groups.map((g) => g.group)).toEqual(['View', 'Go to']);
    expect(groups[0]?.commands.map((c) => c.id)).toEqual(['a', 'c']);
  });

  it('defaults an ungrouped command to "Commands"', () => {
    expect(groupCommands([cmd('a')])[0]?.group).toBe('Commands');
  });

  it('omits disabled commands', () => {
    const groups = groupCommands([cmd('on', 'X', () => true), cmd('off', 'X', () => false)]);
    expect(groups[0]?.commands.map((c) => c.id)).toEqual(['on']);
  });
});
