import * as SwitchPrimitive from '@radix-ui/react-switch';
import { forwardRef, type ComponentPropsWithoutRef, type ComponentRef } from 'react';

import { cn } from '../lib/cn.js';

/**
 * Radix Switch, styled — a labelled on/off control for settings (e.g. the telemetry opt-in). Radix
 * gives it the correct `role="switch"`, `aria-checked`, keyboard toggling, and label association;
 * we style the track and thumb. Always pair it with a visible `<label>` — a switch with no name is
 * a mystery to a screen reader.
 */
export const Switch = forwardRef<
  ComponentRef<typeof SwitchPrimitive.Root>,
  ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>
>(function Switch({ className, ...props }, ref) {
  return (
    <SwitchPrimitive.Root
      ref={ref}
      className={cn(
        'peer inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-transparent',
        'transition-colors duration-(--fx-motion-duration-fast) ease-(--ease-entrance)',
        'data-[state=checked]:bg-accent data-[state=unchecked]:bg-border-strong',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring focus-visible:outline',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          'pointer-events-none block size-4 rounded-full bg-on-accent shadow-sm',
          'transition-transform duration-(--fx-motion-duration-fast) ease-(--ease-entrance)',
          'data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0.5',
        )}
      />
    </SwitchPrimitive.Root>
  );
});
