import { FixoraMark } from '@fixora/ui';
import { useEffect, useState } from 'react';

/** The launch splash: logo, name, tagline, version, and a rotating message while initialization
 *  runs. No timeout copy, no error state — a brief brand moment over the already-mounted app
 *  underneath. */
export type SplashPhase = 'entering' | 'loading' | 'leaving';

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
}: {
  phase: SplashPhase;
  /** The running app version, or null while `system:getAppInfo` is still in flight. */
  version: string | null;
}): React.JSX.Element {
  const message = useLoadingMessage(phase !== 'leaving');

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
      {phase !== 'leaving' && (
        <p key={message} className="px-6 text-center text-sm text-fg-muted opacity-100 transition-opacity duration-300 ease-out">
          {message}
        </p>
      )}
    </div>
  );
}
