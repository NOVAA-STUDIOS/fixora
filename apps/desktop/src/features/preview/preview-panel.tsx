import { CloseIcon, ExternalIcon, RefreshIcon, cn } from '@fixora/ui';
import { useEffect, useRef } from 'react';

import { invoke } from '../../lib/bridge.js';
import { usePreviewStore } from '../../stores/preview-store.js';

/** h-7 status bar — containerRect's own height still includes it, since the status bar sits below
 *  this component in the layout, not inside it. */
const STATUS_BAR_HEIGHT = 28;

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
  const statusMessage = usePreviewStore((s) => s.statusMessage);
  const detectedUrl = usePreviewStore((s) => s.detectedUrl);
  const hasDevScript = usePreviewStore((s) => s.hasDevScript);
  const open = usePreviewStore((s) => s.open);
  const close = usePreviewStore((s) => s.close);
  const refresh = usePreviewStore((s) => s.refresh);
  const goBack = usePreviewStore((s) => s.goBack);
  const goForward = usePreviewStore((s) => s.goForward);
  const canGoBack = usePreviewStore((s) => s.canGoBack);
  const canGoForward = usePreviewStore((s) => s.canGoForward);
  const detect = usePreviewStore((s) => s.detect);
  const checkDevScript = usePreviewStore((s) => s.checkDevScript);
  const launchAndPreview = usePreviewStore((s) => s.launchAndPreview);
  const listen = usePreviewStore((s) => s.listen);
  const containerRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);

  useEffect(() => listen(), [listen]);
  useEffect(() => {
    void detect();
    void checkDevScript();
  }, [detect, checkDevScript]);

  // The native view has no DOM node this component can size with CSS — main positions it in
  // screen coordinates, so the toolbar's and container's own rects (converted from viewport to
  // screen space via `window.screenX/Y`) are resent on every resize either one undergoes.
  useEffect(() => {
    if (!isOpen) return;

    const toolbar = toolbarRef.current;
    const container = containerRef.current;
    if (toolbar === null || container === null) return;

    const sync = (): void => {
      // containerRef already starts below the toolbar in DOM order — its own top is the correct
      // y, and its own height is already the full available height, not the toolbar's.
      const toolbarRect = toolbar.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      // Sanity check — a zero-sized rect (mid-layout, or a collapsed panel) means these coords
      // aren't real yet; resizing the native view to it would just hide/misplace it.
      if (containerRect.width === 0 || containerRect.height === 0) return;
      console.error('[preview] toolbar rect:', JSON.stringify(toolbarRect.toJSON()));
      console.error('[preview] container rect:', JSON.stringify(containerRect.toJSON()));
      console.error('[preview] screen offset:', { screenX: window.screenX, screenY: window.screenY });
      void invoke('preview:resize', {
        x: Math.round(containerRect.left + window.screenX + 8),
        y: Math.round(containerRect.top + window.screenY),
        width: Math.round(containerRect.width - 8),
        height: Math.round(containerRect.height - STATUS_BAR_HEIGHT),
      });
    };
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(toolbar);
    observer.observe(container);
    window.addEventListener('resize', sync);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', sync);
    };
  }, [isOpen]);

  return (
    <div className="flex h-full w-full min-h-0 min-w-0 flex-col bg-canvas">
      {/* Toolbar — compact iOS pill style */}
      <div
        ref={toolbarRef}
        className="flex h-9 shrink-0 items-center gap-1.5 border-b border-border-subtle bg-raised px-2"
      >
        {/* Back/Forward */}
        <button
          type="button"
          onClick={() => void goBack()}
          disabled={!canGoBack}
          title="Go back"
          className="rounded-md p-2 text-fg-secondary transition-colors hover:bg-hover hover:text-fg disabled:cursor-not-allowed disabled:opacity-30"
        >
          <span className="text-base leading-none">←</span>
        </button>
        <button
          type="button"
          onClick={() => void goForward()}
          disabled={!canGoForward}
          title="Go forward"
          className="rounded-md p-2 text-fg-secondary transition-colors hover:bg-hover hover:text-fg disabled:cursor-not-allowed disabled:opacity-30"
        >
          <span className="text-base leading-none">→</span>
        </button>

        {/* URL pill — takes most space */}
        <div className="flex min-w-0 flex-1 items-center gap-2 rounded-lg bg-inset px-2.5 py-1">
          <div
            className={cn(
              'size-1.5 shrink-0 rounded-full transition-colors',
              isLoading ? 'animate-pulse bg-warn' : 'bg-success',
            )}
          />
          <span className="truncate font-mono text-xs text-fg-secondary">{url ?? 'No preview'}</span>
        </div>

        {/* Compact action buttons */}
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={!isOpen}
          title="Refresh (Ctrl+R)"
          className="rounded-md p-1.5 text-fg-secondary transition-colors hover:bg-hover hover:text-fg disabled:opacity-40"
        >
          <RefreshIcon className="size-3.5" />
        </button>

        <button
          type="button"
          onClick={() => {
            if (url !== null) void invoke('system:openExternal', { url });
          }}
          disabled={!isOpen || url === null}
          title="Open in browser"
          className="rounded-md p-1.5 text-fg-secondary transition-colors hover:bg-hover hover:text-fg disabled:opacity-40"
        >
          <ExternalIcon className="size-3.5" />
        </button>

        <button
          type="button"
          onClick={() => void close()}
          disabled={!isOpen}
          title="Close preview"
          className="rounded-md p-1.5 text-fg-secondary transition-colors hover:bg-hover hover:text-fg disabled:opacity-40"
        >
          <CloseIcon className="size-3.5" />
        </button>
      </div>

      {/* WebContentsView placeholder — the native view renders here, positioned by the effect above */}
      <div
        ref={containerRef}
        className="relative flex h-full min-h-0 w-full min-w-0 flex-1 flex-col bg-canvas"
      >
        {isLoading ? (
          // Loading state — full screen, centered
          <div className="flex h-full flex-col items-center justify-center gap-4">
            <div className="size-10 animate-spin rounded-full border-2 border-accent border-t-transparent" />
            <p className="max-w-[240px] animate-pulse text-center text-sm text-fg-secondary">
              {statusMessage ?? 'Preparing your project...'}
            </p>
          </div>
        ) : !isOpen ? (
          <EmptyState
            detectedUrl={detectedUrl}
            hasDevScript={hasDevScript}
            onOpen={open}
            onLaunch={launchAndPreview}
          />
        ) : null}
      </div>
    </div>
  );
}

function EmptyState({
  detectedUrl,
  hasDevScript,
  onOpen,
  onLaunch,
}: {
  detectedUrl: string | null;
  hasDevScript: boolean;
  onOpen: (url: string) => Promise<void>;
  onLaunch: () => Promise<void>;
}): React.JSX.Element {
  return (
    <div className="flex h-full w-full select-none flex-col items-center justify-center gap-6 p-8">
      {/* Animated icon */}
      <div className="relative">
        <div className="flex size-20 animate-ios-enter items-center justify-center rounded-3xl bg-gradient-to-br from-accent/20 to-accent/5 shadow-xl shadow-accent/10 ring-1 ring-accent/20">
          <ExternalIcon className="size-8 text-accent" />
        </div>
        {detectedUrl !== null && (
          <div className="absolute -top-1 -right-1 size-4 animate-pulse rounded-full bg-success ring-2 ring-canvas" />
        )}
      </div>

      <div className="space-y-1.5 text-center">
        <h3 className="text-base font-semibold text-fg">Live Preview</h3>
        <p className="max-w-[200px] text-sm leading-relaxed text-fg-secondary">
          {detectedUrl !== null ? (
            `Dev server found at ${detectedUrl}`
          ) : (
            <>
              Start your dev server and
              <br />
              Fixora will find it automatically.
            </>
          )}
        </p>
      </div>

      {detectedUrl !== null ? (
        <button
          type="button"
          onClick={() => void onOpen(detectedUrl)}
          className="rounded-full bg-accent px-5 py-2 text-sm font-semibold text-on-accent shadow-lg shadow-accent/25 transition-all duration-200 hover:scale-105 hover:shadow-accent/40 active:scale-95"
        >
          Open Preview
        </button>
      ) : hasDevScript ? (
        <button
          type="button"
          onClick={() => void onLaunch()}
          className="rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-on-accent shadow-lg shadow-accent/25 transition-all duration-200 hover:scale-105 hover:shadow-accent/40 active:scale-95"
        >
          ▶ Open Preview
        </button>
      ) : (
        <div className="flex flex-col items-center gap-2 text-center">
          <span className="text-xs text-fg-muted">No dev script found in package.json</span>
          <span className="text-xs text-fg-muted">Add a &lsquo;dev&rsquo; script to get started</span>
        </div>
      )}
    </div>
  );
}
