import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { CommandProvider } from './command-provider.js';
import type { Command } from './registry.js';

/**
 * The other half of "one registry drives everything": the global keybinding listener. These prove
 * a command's keybinding runs *that* command, that a bare-key binding is suppressed while typing
 * in a field, and that a mod-chord fires anywhere — all from the same list the palette renders.
 */
function mount(commands: Command[]): void {
  render(
    <CommandProvider commands={commands}>
      <input data-testid="field" />
    </CommandProvider>,
  );
}

function press(init: KeyboardEventInit, target: EventTarget = document): void {
  target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
}

describe('CommandProvider keybindings', () => {
  it('runs the command bound to a mod chord (Ctrl+K)', () => {
    const run = vi.fn();
    mount([{ id: 'palette.open', title: 'Palette', keybinding: 'mod+k', run }]);
    press({ key: 'k', ctrlKey: true });
    expect(run).toHaveBeenCalledOnce();
  });

  it('does not run a different command', () => {
    const open = vi.fn();
    const theme = vi.fn();
    mount([
      { id: 'palette.open', title: 'Palette', keybinding: 'mod+k', run: open },
      { id: 'view.theme', title: 'Theme', keybinding: 'mod+shift+l', run: theme },
    ]);
    press({ key: 'k', ctrlKey: true });
    expect(open).toHaveBeenCalledOnce();
    expect(theme).not.toHaveBeenCalled();
  });

  it('suppresses a bare-key command while typing in a field', () => {
    const run = vi.fn();
    mount([{ id: 'x', title: 'X', keybinding: 'x', run }]);
    const field = document.querySelector('[data-testid=field]');
    if (field === null) throw new Error('no field');
    press({ key: 'x' }, field);
    expect(run).not.toHaveBeenCalled();
  });

  it('does not run a disabled command', () => {
    const run = vi.fn();
    mount([{ id: 'x', title: 'X', keybinding: 'mod+k', enabled: () => false, run }]);
    press({ key: 'k', ctrlKey: true });
    expect(run).not.toHaveBeenCalled();
  });
});
