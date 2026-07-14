import type { Story } from '@ladle/react';
import { useState } from 'react';

import { Badge } from './badge.js';
import { Button } from './button.js';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from './dialog.js';
import { Input } from './input.js';
import { Kbd } from './kbd.js';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './select.js';
import { Skeleton } from './skeleton.js';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './tabs.js';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './tooltip.js';

export default { title: 'Primitives / Collection' };

export const Badges: Story = () => (
  <div className="flex flex-wrap gap-2">
    <Badge tone="neutral">neutral</Badge>
    <Badge tone="accent">accent</Badge>
    <Badge tone="danger">error</Badge>
    <Badge tone="warn">warning</Badge>
    <Badge tone="success">passed</Badge>
    <Badge tone="info">info</Badge>
  </div>
);

export const TextInput: Story = () => (
  <div className="flex max-w-xs flex-col gap-3">
    <Input placeholder="Search…" aria-label="Search" />
    <Input defaultValue="typed value" aria-label="Value" />
    <Input invalid defaultValue="bad value" aria-label="Invalid" />
    <Input disabled placeholder="Disabled" aria-label="Disabled" />
  </div>
);

export const Keys: Story = () => (
  <p className="flex items-center gap-1 text-fg">
    Open the palette with <Kbd>⌘</Kbd>
    <Kbd>K</Kbd>
  </p>
);

export const Skeletons: Story = () => (
  <div className="flex max-w-sm flex-col gap-2">
    <Skeleton className="h-4 w-40" />
    <Skeleton className="h-4 w-56" />
    <Skeleton className="h-4 w-32" />
  </div>
);

export const WithTooltip: Story = () => (
  <TooltipProvider>
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="secondary">Hover me</Button>
      </TooltipTrigger>
      <TooltipContent>A supplementary hint — never the only label.</TooltipContent>
    </Tooltip>
  </TooltipProvider>
);

export const InDialog: Story = () => (
  <Dialog>
    <DialogTrigger asChild>
      <Button variant="primary">Open dialog</Button>
    </DialogTrigger>
    <DialogContent>
      <DialogTitle className="text-lg font-semibold">Delete all local data?</DialogTitle>
      <DialogDescription className="mt-1 text-sm text-fg-muted">
        This removes your local history. It cannot be undone.
      </DialogDescription>
      <div className="mt-4 flex justify-end gap-2">
        <DialogClose asChild>
          <Button variant="ghost">Cancel</Button>
        </DialogClose>
        <DialogClose asChild>
          <Button variant="danger">Delete</Button>
        </DialogClose>
      </div>
    </DialogContent>
  </Dialog>
);

export const InTabs: Story = () => (
  <Tabs defaultValue="general" className="max-w-md">
    <TabsList>
      <TabsTrigger value="general">General</TabsTrigger>
      <TabsTrigger value="advanced">Advanced</TabsTrigger>
    </TabsList>
    <TabsContent value="general" className="text-sm text-fg-muted">
      General settings live here.
    </TabsContent>
    <TabsContent value="advanced" className="text-sm text-fg-muted">
      Advanced settings live here.
    </TabsContent>
  </Tabs>
);

export const ASelect: Story = () => {
  const [value, setValue] = useState('anthropic');
  return (
    <div className="max-w-xs">
      <Select value={value} onValueChange={setValue}>
        <SelectTrigger aria-label="Provider">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="anthropic">Anthropic</SelectItem>
          <SelectItem value="openai">OpenAI</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
};
