import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useUiStore } from '../../stores/ui-store.js';

import { CommandPalette } from './command-palette.js';
import { CommandProvider } from './command-provider.js';
import type { Command } from './registry.js';

function renderPalette(commands: Command[]) {
  return render(
    <CommandProvider commands={commands}>
      <CommandPalette />
    </CommandProvider>,
  );
}

describe('CommandPalette', () => {
  beforeEach(() => {
    useUiStore.setState({ paletteOpen: false });
  });

  it('is closed when the store says so', () => {
    renderPalette([{ id: 'a', title: 'A', run: () => {} }]);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens as a modal dialog with a labelled search field', async () => {
    useUiStore.setState({ paletteOpen: true });
    renderPalette([{ id: 'a', title: 'A', run: () => {} }]);
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveAccessibleName('Command palette');
    expect(screen.getByPlaceholderText(/Type a command/)).toBeInTheDocument();
  });

  it('opens from Ctrl+K and closes with Escape', async () => {
    renderPalette([{
      id: 'palette.open', title: 'Open command palette', keybinding: 'mod+k',
      run: () => useUiStore.setState({ paletteOpen: true }),
    }]);
    fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
    const dialog = await screen.findByRole('dialog');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('filters commands and runs the keyboard-selected match', async () => {
    const explain = vi.fn();
    const fix = vi.fn();
    const fixTests = vi.fn();
    const user = userEvent.setup();
    useUiStore.setState({ paletteOpen: true });
    renderPalette([
      { id: 'zappr.explain', title: 'Explain selection or file', group: 'AI', keywords: ['explain', 'zappr'], run: explain },
      { id: 'zappr.fix', title: 'Fix errors', group: 'AI', keywords: ['repair', 'zappr'], run: fix },
      { id: 'zappr.fixTests', title: 'Fix tests', group: 'AI', keywords: ['repair', 'zappr'], run: fixTests },
    ]);
    const input = screen.getByPlaceholderText(/Type a command/);
    await user.type(input, 'repair');
    expect(await screen.findByRole('option', { name: /Fix errors/i })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Explain selection/i })).not.toBeInTheDocument();
    await user.keyboard('{ArrowDown}{Enter}');
    await waitFor(() => {
      expect(fixTests).toHaveBeenCalledOnce();
    });
    expect(explain).not.toHaveBeenCalled();
    expect(fix).not.toHaveBeenCalled();
  });
});
