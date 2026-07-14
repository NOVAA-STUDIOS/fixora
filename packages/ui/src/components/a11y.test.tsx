import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { axeViolations, formatViolations } from '../test/axe.js';

import { Badge } from './badge.js';
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from './dialog.js';
import { Input } from './input.js';
import { Kbd } from './kbd.js';
import { Skeleton } from './skeleton.js';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './tabs.js';

async function expectNoViolations(container: Element): Promise<void> {
  const violations = await axeViolations(container);
  expect(violations, formatViolations(violations)).toEqual([]);
}

/**
 * The M1 acceptance gate: "axe-core reports zero critical violations". We assert zero critical
 * AND serious across the primitives, including an overlay in its open state — where a11y bugs
 * (focus trap, labelling, roles) actually live.
 */
describe('a11y — primitives report no critical/serious axe violations', () => {
  it('static primitives', async () => {
    const { container } = render(
      <main>
        <label htmlFor="q">Search</label>
        <Input id="q" placeholder="Search…" />
        <Badge tone="danger">error</Badge>
        <Badge tone="warn">warning</Badge>
        <Badge tone="success">passed</Badge>
        <p>
          Press <Kbd>⌘</Kbd>
          <Kbd>K</Kbd>
        </p>
        <Skeleton className="h-4 w-32" />
      </main>,
    );
    await expectNoViolations(container);
  });

  it('tabs', async () => {
    const { container } = render(
      <Tabs defaultValue="a">
        <TabsList>
          <TabsTrigger value="a">General</TabsTrigger>
          <TabsTrigger value="b">Advanced</TabsTrigger>
        </TabsList>
        <TabsContent value="a">General settings</TabsContent>
        <TabsContent value="b">Advanced settings</TabsContent>
      </Tabs>,
    );
    await expectNoViolations(container);
  });

  it('dialog in its open state (focus trap, labelling)', async () => {
    const user = userEvent.setup();
    render(
      <Dialog>
        <DialogTrigger>Open</DialogTrigger>
        <DialogContent>
          <DialogTitle>Delete all local data?</DialogTitle>
          <DialogDescription>This cannot be undone.</DialogDescription>
        </DialogContent>
      </Dialog>,
    );
    await user.click(screen.getByRole('button', { name: 'Open' }));
    const dialog = await screen.findByRole('dialog');
    // Radix wires the title/description to the dialog; axe checks the wiring is correct.
    await expectNoViolations(dialog);
  });
});
