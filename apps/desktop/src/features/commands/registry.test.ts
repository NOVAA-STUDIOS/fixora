import { describe, expect, it, vi } from 'vitest';

import { createCommandRegistry, isCommandEnabled, type Command } from './registry.js';

const noop = (): void => {};

describe('command registry', () => {
  it('registers and lists commands', () => {
    const r = createCommandRegistry();
    r.register({ id: 'a', title: 'A', run: noop });
    r.register({ id: 'b', title: 'B', run: noop });
    expect(r.all().map((c) => c.id)).toEqual(['a', 'b']);
    expect(r.get('a')?.title).toBe('A');
  });

  it('rejects a duplicate id — two commands with one id is a drift bug', () => {
    const r = createCommandRegistry();
    r.register({ id: 'a', title: 'A', run: noop });
    expect(() => {
      r.register({ id: 'a', title: 'A again', run: noop });
    }).toThrow(/twice/);
  });

  it('unregister removes the command', () => {
    const r = createCommandRegistry();
    const off = r.register({ id: 'a', title: 'A', run: noop });
    off();
    expect(r.get('a')).toBeUndefined();
    // And the id is free again after removal.
    expect(() => r.register({ id: 'a', title: 'A', run: noop })).not.toThrow();
  });

  it('runs the command function', () => {
    const r = createCommandRegistry();
    const run = vi.fn();
    r.register({ id: 'a', title: 'A', run });
    r.get('a')?.run();
    expect(run).toHaveBeenCalledOnce();
  });

  it('treats a command as enabled unless its predicate says otherwise', () => {
    const enabled: Command = { id: 'a', title: 'A', run: noop, enabled: () => true };
    const disabled: Command = { id: 'b', title: 'B', run: noop, enabled: () => false };
    const defaulted: Command = { id: 'c', title: 'C', run: noop };
    expect(isCommandEnabled(enabled)).toBe(true);
    expect(isCommandEnabled(disabled)).toBe(false);
    expect(isCommandEnabled(defaulted)).toBe(true);
  });
});
