import type { Story } from '@ladle/react';

import { Button } from './button.js';

export default { title: 'Primitives / Button' };

export const Variants: Story = () => (
  <div className="flex flex-wrap items-center gap-3">
    <Button variant="primary">Primary</Button>
    <Button variant="secondary">Secondary</Button>
    <Button variant="ghost">Ghost</Button>
    <Button variant="danger">Danger</Button>
  </div>
);

export const Sizes: Story = () => (
  <div className="flex flex-wrap items-center gap-3">
    <Button size="sm">Small</Button>
    <Button size="md">Medium</Button>
    <Button size="lg">Large</Button>
    <Button size="icon" aria-label="Icon">
      <span aria-hidden>★</span>
    </Button>
  </div>
);

export const Disabled: Story = () => (
  <div className="flex gap-3">
    <Button variant="primary" disabled>
      Primary
    </Button>
    <Button variant="secondary" disabled>
      Secondary
    </Button>
  </div>
);

export const AsLink: Story = () => (
  <Button asChild variant="primary">
    <a href="https://fixora.dev">A link styled as a button</a>
  </Button>
);
