import { render, screen } from '@testing-library/react';
import { describe, expect, it, beforeEach } from 'vitest';

import { useUiStore } from '../../stores/ui-store.js';

import { CommandPalette } from './command-palette.js';
import { CommandProvider } from './command-provider.js';
import type { Command } from './registry.js';

/**
 * The palette's item list is rendered by cmdk, whose filtering relies on real layout that jsdom
 * does not compute — so the item-level behaviour (filter, select) is verified in the real app,
 * not here. What this test pins is the wiring that jsdom *can* observe reliably: the palette is a
 * modal dialog, it opens from the store, and it presents a labelled search field. The command
 * derivation it renders is tested as a pure function in palette-model.test.ts.
 */
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
    expect(screen.getByPlaceholderText('Type a command…')).toBeInTheDocument();
  });
});
