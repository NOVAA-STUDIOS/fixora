import { CloseIcon, ExternalIcon, RefreshIcon, cn } from '@fixora/ui';
import { useEffect, useRef } from 'react';

import { invoke } from '../../lib/bridge.js';
import { usePreviewStore } from '../../stores/preview-store.js';

/**
 * Fixora Preview: an embedded WebContentsView showing the user's own localhost dev server,
 * positioned under this component's own placeholder `<div>` — the native view is a sibling of
 * the renderer's DOM, not inside it, so `containerRef`'s `ResizeObserver` is what keeps the two
 * in sync (see the resize effect below). `preview-service.ts` owns the actual view and every
 * navigation guard; this component only reflects `usePreviewStore`'s state and asks main to move
 * or resize what it owns.
 */
export function PreviewPanel(): React.JSX.Element {
  const isOpen = usePreviewStore((s) => s.isOpen);
  const url = usePreviewStore((s) => s.url);
  const isLoading = usePreviewStore((s) => s.isLoading);
  const detectedUrl = usePreviewStore((s) => s.detectedUrl);
  const open = usePreviewStore((s) => s.open);
  const close = usePreviewStore((s) => s.close);
  const refresh = usePreviewStore((s) => s.refresh);
  const detect = usePreviewStore((s) => s.detect);
  const listen = usePreviewStore((s) => s.listen);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => listen(), [listen]);
  useEffect(() => {
    void detect();
  }, [detect]);

  // The native view has no DOM node this component can size with CSS — main positions it in
  // screen coordinates, so this container's own rect (converted from viewport to screen space via
  // `window.screenX/Y`) is resent on every resize this container undergoes.
  useEffect(() => {
    const el = containerRef.current;
    if (el === null || !isOpen) return;
    const sync = (): void => {
      const rect = el.getBoundingClientRect();
      void invoke('preview:resize', {
        x: Math.round(window.screenX + rect.left),
        y: Math.round(window.screenY + rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      });
    };
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(el);
    window.addEventListener('resize', sync);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', sync);
    };
  }, [isOpen]);

  return (
    <div className="flex h-full flex-col bg-canvas">
      {/* Toolbar — frosted glass iOS style */}
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border-subtle bg-raised px-3">
        {/* URL bar — pill shape */}
        <div className="flex flex-1 items-center gap-2 rounded-full bg-inset px-3 py-1 text-sm text-fg-secondary">
          <div
            className={cn('size-2 rounded-full', isLoading ? 'animate-pulse bg-warn' : 'bg-success')}
          />
          <span className="truncate">{url ?? 'No preview open'}</span>
        </div>

        <button
          type="button"
          onClick={() => void refresh()}
          disabled={!isOpen}
          title="Refresh"
          className="rounded-lg p-1.5 transition-colors hover:bg-hover disabled:opacity-40"
        >
          <RefreshIcon className="size-4" />
        </button>

        <button
          type="button"
          onClick={() => {
            if (url !== null) void invoke('system:openExternal', { url });
          }}
          disabled={!isOpen || url === null}
          title="Open in browser"
          className="rounded-lg p-1.5 transition-colors hover:bg-hover disabled:opacity-40"
        >
          <ExternalIcon className="size-4" />
        </button>

        <button
          type="button"
          onClick={() => void close()}
          disabled={!isOpen}
          title="Close preview"
          className="rounded-lg p-1.5 transition-colors hover:bg-hover disabled:opacity-40"
        >
          <CloseIcon className="size-4" />
        </button>
      </div>

      {/* WebContentsView placeholder — the native view renders here, positioned by the effect above */}
      <div ref={containerRef} className="relative min-h-0 flex-1 bg-white">
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-canvas/80 backdrop-blur-sm">
            <div className="flex flex-col items-center gap-3">
              <div className="size-8 animate-spin rounded-full border-2 border-accent border-t-transparent" />
              <span className="text-sm text-fg-secondary">Loading…</span>
            </div>
          </div>
        )}
        {!isOpen && <EmptyState detectedUrl={detectedUrl} onOpen={open} />}
      </div>
    </div>
  );
}

function EmptyState({
  detectedUrl,
  onOpen,
}: {
  detectedUrl: string | null;
  onOpen: (url: string) => Promise<void>;
}): React.JSX.Element {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-8">
      <div className="flex size-16 animate-ios-enter items-center justify-center rounded-2xl bg-accent/10 shadow-lg shadow-accent/20">
        <span className="text-3xl">🌐</span>
      </div>

      <div className="text-center">
        <h3 className="font-semibold text-fg">Live Preview</h3>
        <p className="mt-1 text-sm text-fg-secondary">
          Start your dev server and Fixora
          <br />
          will detect it automatically.
        </p>
      </div>

      {detectedUrl !== null ? (
        <button
          type="button"
          onClick={() => void onOpen(detectedUrl)}
          className="rounded-full bg-accent px-4 py-2 text-sm font-medium text-on-accent shadow-lg shadow-accent/30 transition-all hover:shadow-accent/50 active:scale-95"
        >
          Open {detectedUrl}
        </button>
      ) : (
        <div className="text-xs text-fg-muted">
          Run{' '}
          <code className="rounded bg-inset px-1.5 py-0.5">npm run dev</code> in the terminal
        </div>
      )}
    </div>
  );
}
