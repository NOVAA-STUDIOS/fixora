import { useEffect, useState } from 'react';

import { AppShell } from '../features/shell/app-shell.js';
import { SplashScreen } from '../features/shell/splash-screen.js';
import { useFileWatch } from '../features/workspace/use-file-watch.js';
import { useWorkspaceStore } from '../features/workspace/workspace-store.js';
import { useAppearance } from '../hooks/use-appearance.js';

/**
 * The root. It applies the persisted appearance (theme + density), adopts any workspace the main
 * process restored on launch (reopen-last-project), keeps the tree in sync with disk, then renders
 * the application shell.
 *
 * The splash covers hydration — the workspace restore and its first directory listing — and leaves
 * as soon as that settles. The floor below is the only timing here that is not real work, and it
 * exists because a splash that vanishes in 40ms reads as a glitch rather than as a launch.
 */
const SPLASH_MIN_MS = 750;
const SPLASH_FADE_MS = 300;

export function App(): React.JSX.Element {
  useAppearance();
  useFileWatch();
  const hydrateCurrent = useWorkspaceStore((s) => s.hydrateCurrent);

  const [phase, setPhase] = useState<'booting' | 'leaving' | 'ready'>('booting');

  useEffect(() => {
    let cancelled = false;
    const startedAt = Date.now();

    const finish = (): void => {
      if (cancelled) return;
      setPhase('leaving');
      // Unmount only after the fade, so the workbench is never revealed by an element popping out.
      setTimeout(() => {
        if (!cancelled) setPhase('ready');
      }, SPLASH_FADE_MS);
    };

    void hydrateCurrent()
      // A failed restore must still let the user in: they land on "Open a project", which is exactly
      // the right place to be when there was no workspace to restore.
      .catch(() => undefined)
      .then(() => {
        setTimeout(finish, Math.max(0, SPLASH_MIN_MS - (Date.now() - startedAt)));
      });

    return () => {
      cancelled = true;
    };
  }, [hydrateCurrent]);

  return (
    <div aria-busy={phase !== 'ready'} className="contents">
      <AppShell />
      {phase !== 'ready' && <SplashScreen leaving={phase === 'leaving'} />}
    </div>
  );
}
