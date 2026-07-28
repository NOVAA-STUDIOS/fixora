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
  working,
  errorMessage,
  version,
  onRetry,
  onDismiss,
}: {
  phase: SplashPhase;
  /** What initialization is currently doing. Replaced by the error copy when it fails. */
  message: string;
  /** Whether initialization is genuinely still running — the loading indicator only ever shows
   *  while this is true (req. 5), never during the brief animation-completion wait after it's done. */
  working: boolean;
  errorMessage: string | null;
  /** The running app version, or null while `system:getAppInfo` is still in flight. */
  version: string | null;
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
          {/* Rendered only once fetched — an absent version is silence, never a placeholder.
              Plain `text-fg-muted` (no opacity modifier): an ad-hoc `/70` opacity is invisible to
              the automated contrast gate, which only audits the defined token pairs (Beta audit A1,
              Light/Dark Mode finding 1). The 11px size alone still reads as secondary next to the
              14px tagline above it. */}
          {version !== null && <p className="text-[11px] tabular-nums text-fg-muted">v{version}</p>}
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
          {/* An indeterminate sweep, not a percentage — and shown only while work is genuinely
              still running (req. 5). Once initialization resolves, the indicator disappears
              immediately even if the splash itself is still up for the brief remainder of the
              entrance-animation floor; a spinner that keeps moving after the work it represents has
              finished is a small dishonesty the same way a progress bar with a made-up percentage
              would be. */}
          {working && (
            <div className="h-0.5 w-40 overflow-hidden rounded-full bg-border-subtle">
              <div className="motion-safe:animate-[fx-splash-sweep_1.4s_ease-in-out_infinite] h-full w-1/3 rounded-full bg-accent" />
            </div>
          )}
          {/* aria-live so the sequence is announced rather than silently swapped under a reader. */}
          <p aria-live="polite" className="max-w-xs px-6 text-center text-xs text-fg-muted">
            {message}
          </p>
        </div>
      )}
    </div>
  );
}
