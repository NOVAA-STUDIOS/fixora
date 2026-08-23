import {
  AlertIcon,
  CheckIcon,
  Toast,
  ToastClose,
  ToastProvider,
  ToastTitle,
  ToastViewport,
  WinCloseIcon,
  cn,
} from '@fixora/ui';
import { useEffect } from 'react';

import { subscribe } from '../../lib/bridge.js';
import {
  MAX_VISIBLE_TOASTS,
  toast,
  useToastStore,
  type ToastTone,
} from '../../stores/toast-store.js';

/** Tone → the icon chip's colours. Uses the semantic tokens, so it follows the theme rather than
 *  hard-coding a green/yellow/red/blue that only works in one of them. */
const TONE_STYLE: Record<ToastTone, string> = {
  success: 'bg-success-subtle text-success-text',
  warning: 'bg-warn-subtle text-warn-text',
  error: 'bg-danger-subtle text-danger-text',
  info: 'bg-accent-subtle text-accent-text',
};

/**
 * The toast host. Mounted once in the shell; every surface pushes through `toast.*` rather than
 * owning its own notification state.
 *
 * Also owns the one push event with no dedicated store of its own (`workspace:largeProject`) — a
 * single informational notice does not earn a store the way `update-store.ts` does for a
 * multi-state banner, and this component is already the guaranteed-once mount point for it.
 */
export function Toaster(): React.JSX.Element {
  const allToasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);
  // Oldest first, capped: the queue keeps the rest and they surface as these expire.
  const toasts = allToasts.slice(0, MAX_VISIBLE_TOASTS);

  useEffect(
    () =>
      subscribe('workspace:largeProject', ({ fileCount }) => {
        toast.success(
          'Large project',
          `${fileCount.toLocaleString()} files found. node_modules, dist, build and similar folders are excluded from analysis by default.`,
        );
      }),
    [],
  );

  return (
    <ToastProvider swipeDirection="right" duration={Infinity}>
      {toasts.map((t) => (
        <Toast
          key={t.id}
          open
          onOpenChange={(open) => {
            if (!open) dismiss(t.id);
          }}
          className="flex items-center gap-2.5"
        >
          <span
            className={cn(
              'flex size-5 shrink-0 items-center justify-center rounded-full',
              TONE_STYLE[t.tone],
            )}
          >
            {t.tone === 'success' ? (
              <CheckIcon className="size-3" />
            ) : (
              <AlertIcon className="size-3" />
            )}
          </span>
          <span className="flex min-w-0 flex-col gap-0.5">
            <ToastTitle className="text-sm font-medium text-fg">{t.title}</ToastTitle>
            {t.description !== undefined && (
              <span className="text-xs leading-relaxed text-fg-muted">{t.description}</span>
            )}
          </span>
          <ToastClose
            aria-label="Dismiss"
            className="ml-auto shrink-0 rounded p-1 text-fg-muted transition-colors duration-(--fx-motion-duration-fast) hover:bg-hover hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus-ring focus-visible:outline"
          >
            <WinCloseIcon className="size-3" />
          </ToastClose>
        </Toast>
      ))}
      <ToastViewport />
    </ToastProvider>
  );
}
