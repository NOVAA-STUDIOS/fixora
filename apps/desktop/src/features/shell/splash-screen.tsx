import { AlertIcon, FixoraMark } from '@fixora/ui';
import { useEffect, useState } from 'react';

/** The launch splash: logo, name, tagline, version, and a rotating message while initialization
 *  runs — or, if `app:ready` never arrives, an error state with a restart action. */
export type SplashPhase = 'entering' | 'loading' | 'leaving' | 'error';

const LOADING_MESSAGES = [
  'Getting your codebase ready...',
  'Warming up the analyzers...',
  'Loading AI repair engine...',
  'Almost there...',
  'Preparing your workspace...',
  'Checking for bugs to fix...',
  'Setting up IntelliSense...',
  'Ready to fix smarter! ✨',
] as const;

const FIRST_MESSAGE = LOADING_MESSAGES[0];
const MESSAGE_INTERVAL_MS = 800;

function useLoadingMessage(active: boolean): string {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => {
      setIndex((i) => (i + 1) % LOADING_MESSAGES.length);
    }, MESSAGE_INTERVAL_MS);
    return () => {
      clearInterval(timer);
    };
  }, [active]);
  return LOADING_MESSAGES[index] ?? FIRST_MESSAGE;
}

export function SplashScreen({
  phase,
  version,
  errorMessage,
}: {
  phase: SplashPhase;
  /** The running app version, or null while `system:getAppInfo` is still in flight. */
  version: string | null;
  /** Shown only when `phase === 'error'`. */
  errorMessage?: string;
}): React.JSX.Element {
  // Loading messages stop rotating once there is an error to show instead.
  const message = useLoadingMessage(phase !== 'leaving' && phase !== 'error');

  return (
    <div
      aria-hidden="true"
      className={[
        'fixed inset-0 z-50 flex flex-col items-center justify-center gap-5 bg-canvas',
        'transition-opacity duration-300 ease-out',
        phase === 'leaving' ? 'opacity-0 pointer-events-none' : 'opacity-100',
      ].join(' ')}
    >
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
        {version !== null && <p className="text-[11px] tabular-nums text-fg-muted">v{version}</p>}
      </div>
      {phase === 'error' ? (
        <div className="flex flex-col items-center gap-3 px-6 text-center">
          <AlertIcon className="size-6 text-fg-muted" />
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium text-fg">Taking longer than usual…</p>
            <p className="text-xs text-fg-muted">Something may have gone wrong on startup.</p>
            {errorMessage !== undefined && (
              <p className="text-[11px] text-fg-muted">{errorMessage}</p>
            )}
          </div>
          <button
            type="button"
            onClick={() => {
              window.close();
            }}
            className="rounded-full bg-hover px-4 py-1.5 text-xs font-medium text-fg hover:bg-active"
          >
            Restart Fixora
          </button>
        </div>
      ) : (
        phase !== 'leaving' && (
          <p key={message} className="px-6 text-center text-sm text-fg-muted opacity-100 transition-opacity duration-300 ease-out">
            {message}
          </p>
        )
      )}
    </div>
  );
}
