import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { axeViolations, formatViolations } from '../test/axe.js';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './dropdown-menu.js';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './select.js';

async function expectNoViolations(container: Element): Promise<void> {
  const violations = await axeViolations(container);
  expect(violations, formatViolations(violations)).toEqual([]);
}

/**
 * The interactive overlays are where accessibility actually breaks (roles, focus, labelling), so
 * they get the axe treatment in their *open* state plus a keyboard-operability check — the M1
 * acceptance criteria are "operable with the keyboard alone" and "zero critical axe violations".
 */
describe('Select', () => {
  it('opens on click and reports its value with no axe violations', async () => {
    const user = userEvent.setup();
    render(
      <Select defaultValue="anthropic">
        <SelectTrigger aria-label="Provider">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="anthropic">Anthropic</SelectItem>
          <SelectItem value="openai">OpenAI</SelectItem>
        </SelectContent>
      </Select>,
    );

    const trigger = screen.getByRole('combobox', { name: 'Provider' });
    expect(trigger).toHaveTextContent('Anthropic');
    await user.click(trigger);
    // Radix renders the listbox; axe checks the option roles and labelling.
    await expectNoViolations(document.body);
  });
});

describe('DropdownMenu', () => {
  it('opens and runs an item selected by keyboard', async () => {
    const user = userEvent.setup();
    let picked = '';
    render(
      <DropdownMenu>
        <DropdownMenuTrigger aria-label="Actions">Actions</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onSelect={() => (picked = 'rename')}>Rename</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => (picked = 'delete')}>Delete</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );

    await user.click(screen.getByRole('button', { name: 'Actions' }));
    await expectNoViolations(document.body);
    // Arrow to the second item and activate it — keyboard-only operation.
    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}');
    expect(picked).toBe('delete');
  });
});
