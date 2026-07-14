import { Command as CommandPrimitive } from 'cmdk';
import { forwardRef, type ComponentPropsWithoutRef, type ComponentRef } from 'react';

import { cn } from '../lib/cn.js';

import { SearchIcon } from './icons.js';

/**
 * The command-palette surface, on `cmdk`. cmdk owns the fiddly, accessibility-critical parts of a
 * palette — fuzzy filtering, arrow-key navigation with `aria-activedescendant`, and the listbox
 * semantics — which is exactly the surface axe-core (an M1 acceptance gate) scrutinises hardest,
 * and exactly the surface a hand-rolled version gets subtly wrong.
 *
 * This is presentational. The **source of truth for what commands exist is the app's command
 * registry** (TDD §8.4), not this component: the palette, the menu bar and the keybindings all
 * derive from that one registry, so they cannot drift. This just renders what it is given.
 */
export const Command = forwardRef<
  ComponentRef<typeof CommandPrimitive>,
  ComponentPropsWithoutRef<typeof CommandPrimitive>
>(function Command({ className, ...props }, ref) {
  return (
    <CommandPrimitive
      ref={ref}
      className={cn('flex h-full w-full flex-col overflow-hidden rounded-lg', className)}
      {...props}
    />
  );
});

export const CommandInput = forwardRef<
  ComponentRef<typeof CommandPrimitive.Input>,
  ComponentPropsWithoutRef<typeof CommandPrimitive.Input>
>(function CommandInput({ className, ...props }, ref) {
  return (
    <div className="flex items-center gap-2 border-b border-border-subtle px-3">
      <SearchIcon className="size-4 shrink-0 text-fg-muted" />
      <CommandPrimitive.Input
        ref={ref}
        className={cn(
          'h-11 w-full bg-transparent text-sm text-fg outline-none placeholder:text-fg-muted',
          className,
        )}
        {...props}
      />
    </div>
  );
});

export const CommandList = forwardRef<
  ComponentRef<typeof CommandPrimitive.List>,
  ComponentPropsWithoutRef<typeof CommandPrimitive.List>
>(function CommandList({ className, ...props }, ref) {
  return (
    <CommandPrimitive.List
      ref={ref}
      className={cn('max-h-80 overflow-y-auto overflow-x-hidden p-1', className)}
      {...props}
    />
  );
});

export const CommandEmpty = forwardRef<
  ComponentRef<typeof CommandPrimitive.Empty>,
  ComponentPropsWithoutRef<typeof CommandPrimitive.Empty>
>(function CommandEmpty({ className, ...props }, ref) {
  return (
    <CommandPrimitive.Empty
      ref={ref}
      className={cn('py-8 text-center text-sm text-fg-muted', className)}
      {...props}
    />
  );
});

export const CommandGroup = forwardRef<
  ComponentRef<typeof CommandPrimitive.Group>,
  ComponentPropsWithoutRef<typeof CommandPrimitive.Group>
>(function CommandGroup({ className, ...props }, ref) {
  return (
    <CommandPrimitive.Group
      ref={ref}
      className={cn(
        'overflow-hidden p-1 text-fg',
        '[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5',
        '[&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-fg-muted',
        className,
      )}
      {...props}
    />
  );
});

export const CommandItem = forwardRef<
  ComponentRef<typeof CommandPrimitive.Item>,
  ComponentPropsWithoutRef<typeof CommandPrimitive.Item>
>(function CommandItem({ className, ...props }, ref) {
  return (
    <CommandPrimitive.Item
      ref={ref}
      className={cn(
        'relative flex h-(--fx-control-height-md) cursor-default select-none items-center gap-2 rounded-md px-2 text-sm',
        'text-fg outline-none',
        'data-[selected=true]:bg-hover data-[selected=true]:text-fg',
        'data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50',
        className,
      )}
      {...props}
    />
  );
});
