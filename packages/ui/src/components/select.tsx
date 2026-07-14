import * as SelectPrimitive from '@radix-ui/react-select';
import { forwardRef, type ComponentPropsWithoutRef, type ComponentRef } from 'react';

import { cn } from '../lib/cn.js';

import { CheckIcon, ChevronDownIcon } from './icons.js';

/**
 * Radix Select, styled. A native `<select>` cannot be styled to match the app, and a hand-rolled
 * one is an accessibility minefield (typeahead, arrow keys, `aria-activedescendant`, screen-reader
 * announcement of the selected value). Radix gives all of that; we style the trigger and popup.
 * Used in Settings (M2).
 */
export const Select = SelectPrimitive.Root;
export const SelectValue = SelectPrimitive.Value;
export const SelectGroup = SelectPrimitive.Group;

export const SelectTrigger = forwardRef<
  ComponentRef<typeof SelectPrimitive.Trigger>,
  ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>
>(function SelectTrigger({ className, children, ...props }, ref) {
  return (
    <SelectPrimitive.Trigger
      ref={ref}
      className={cn(
        'inline-flex h-(--fx-control-height-md) items-center justify-between gap-2 rounded-md',
        'px-(--fx-control-padding-x) text-sm',
        'bg-inset text-fg border border-border-strong',
        'hover:border-accent-border',
        'focus-visible:border-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring focus-visible:outline',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'data-[placeholder]:text-fg-muted',
        className,
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon>
        <ChevronDownIcon className="size-4 text-fg-muted" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
});

export const SelectContent = forwardRef<
  ComponentRef<typeof SelectPrimitive.Content>,
  ComponentPropsWithoutRef<typeof SelectPrimitive.Content>
>(function SelectContent({ className, children, position = 'popper', ...props }, ref) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        ref={ref}
        position={position}
        className={cn(
          'z-(--fx-z-popover) overflow-hidden rounded-md',
          'bg-overlay text-fg border border-border-subtle shadow-lg',
          'data-[state=open]:animate-in data-[state=closed]:animate-out motion-reduce:animate-none',
          position === 'popper' && 'w-[var(--radix-select-trigger-width)]',
          className,
        )}
        {...props}
      >
        <SelectPrimitive.Viewport className="p-1">{children}</SelectPrimitive.Viewport>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
});

export const SelectItem = forwardRef<
  ComponentRef<typeof SelectPrimitive.Item>,
  ComponentPropsWithoutRef<typeof SelectPrimitive.Item>
>(function SelectItem({ className, children, ...props }, ref) {
  return (
    <SelectPrimitive.Item
      ref={ref}
      className={cn(
        'relative flex h-(--fx-row-height) cursor-default select-none items-center rounded-sm',
        'pl-7 pr-2 text-sm outline-none',
        'data-[highlighted]:bg-hover data-[highlighted]:text-fg',
        'data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        className,
      )}
      {...props}
    >
      <span className="absolute left-1.5 flex items-center">
        <SelectPrimitive.ItemIndicator>
          <CheckIcon className="size-4 text-accent-text" />
        </SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  );
});
