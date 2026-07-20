import { Button, FixoraMark } from '@fixora/ui';

/**
 * The launch splash.
 *
 * It sits inside the renderer rather than in a second BrowserWindow. A splash window would mean
 * another window to secure, position and tear down, for a moment of branding — the window itself is
 * already held back until `ready-to-show`, so this is the first thing painted either way.
 *
 * Startup is **not blocked on this screen**: hydration is an async call that begins as soon as `App`
 * mounts and runs while the splash is painted. The splash observes that work; it never gates it.
 *
 * The failure state is the part that matters most. Initialization can fail — a restored workspace
 * whose folder is gone, a filesystem that refuses a listing — and a launch screen with no exit is
 * the worst possible response, because the user cannot even reach Settings to fix it. So a failure
 * is shown, explained, and offers both a retry and a way past it.
 *
 * Every animation is wrapped in `motion-safe:`, so a user who asked their OS to reduce motion gets
 * the same screen, composed and still.
 */

export type SplashPhase = 'entering' | 'loading' | 'error' | 'leaving';

export function SplashScreen({
  phase,
  message,
  errorMessage,
  onRetry,
  onDismiss,
}: {
  phase: SplashPhase;
  /** What initialization is currently doing. Replaced by the error copy when it fails. */
  message: string;
  errorMessage: string | null;
  onRetry: () => void;
  /** Continue without a restored workspace — the app is usable, it just has no project open. */
  onDismiss: () => void;
}): React.JSX.Element {
  const failed = phase === 'error';

  return (
    <div
      // In the failure state this stops being decoration and becomes the only thing on screen, so it
      // is announced and focusable. While loading it stays out of the way: `aria-busy` on the root
      // already tells a screen reader the app is starting.
      {...(failed
        ? { role: 'alertdialog' as const, 'aria-label': 'Fixora could not start' }
        : { 'aria-hidden': true })}
      className={[
        'fixed inset-0 z-50 flex flex-col items-center justify-center gap-5 bg-canvas',
        'transition-opacity duration-300 ease-out',
        phase === 'entering' || phase === 'leaving' ? 'opacity-0' : 'opacity-100',
        phase === 'leaving' ? 'pointer-events-none' : '',
      ].join(' ')}
    >
      {/* A staggered entrance for elements that are otherwise unchanged — same mark, wordmark,
          tagline, colours and type, arriving in the order you read them rather than all at once.
          Delays are on the existing keyframe, so `motion-safe:` still governs the whole thing and a
          reduce-motion user sees the finished composition immediately. */}
      <div className="flex flex-col items-center gap-4">
        <FixoraMark
          className="motion-safe:animate-[fx-splash-in_420ms_ease-out_both] size-16 drop-shadow-lg"
          title="Fixora"
        />
        <div
          className="motion-safe:animate-[fx-splash-in_420ms_ease-out_both] flex flex-col items-center gap-1.5"
          style={{ animationDelay: '500ms' }}
        >
          <h1 className="text-2xl font-semibold tracking-tight text-fg">Fixora</h1>
          <p className="text-sm text-fg-muted">Fix smarter. Ship faster.</p>
        </div>
      </div>

      {failed ? (
        <div className="flex max-w-sm flex-col items-center gap-3 px-6 text-center">
          <p role="alert" className="text-sm text-danger-text [overflow-wrap:anywhere]">
            {errorMessage ?? 'Fixora could not finish starting up.'}
          </p>
          <p className="text-xs text-fg-muted">
            Your projects and history are on disk and untouched. Continuing opens Fixora with no
            project — you can open one from the Files panel.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Button variant="primary" size="sm" onClick={onRetry} autoFocus>
              Try again
            </Button>
            <Button variant="ghost" size="sm" onClick={onDismiss}>
              Continue anyway
            </Button>
          </div>
        </div>
      ) : (
        <div
          className="motion-safe:animate-[fx-splash-in_420ms_ease-out_both] flex flex-col items-center gap-3"
          style={{ animationDelay: '900ms' }}
        >
          {/* An indeterminate sweep, not a percentage. Startup is two round-trips that typically
              finish in well under a second — a percentage over two coarse steps would be a number
              invented to look precise, and a progress bar that lies is worse than one that only says
              "working". The sweep keeps animating for as long as this screen is up. */}
          <div className="h-0.5 w-40 overflow-hidden rounded-full bg-border-subtle">
            <div className="motion-safe:animate-[fx-splash-sweep_1.4s_ease-in-out_infinite] h-full w-1/3 rounded-full bg-accent" />
          </div>
          {/* aria-live so the sequence is announced rather than silently swapped under a reader. */}
          <p aria-live="polite" className="max-w-xs px-6 text-center text-xs text-fg-muted">
            {message}
          </p>
        </div>
      )}
    </div>
  );
}
