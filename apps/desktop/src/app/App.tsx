import { useCallback } from 'react';

import { AppShell } from '../features/shell/app-shell.js';
import { SplashScreen } from '../features/shell/splash-screen.js';
import { useSplash } from '../features/shell/use-splash.js';
import { useFileWatch } from '../features/workspace/use-file-watch.js';
import { useWorkspaceStore } from '../features/workspace/workspace-store.js';
import { useAppearance } from '../hooks/use-appearance.js';

/**
 * The root. It applies the persisted appearance (theme + density), adopts any workspace the main
 * process restored on launch (reopen-last-project), keeps the tree in sync with disk, then renders
 * the application shell.
 *
 * The workbench mounts *underneath* the splash from the first frame, so initialization and the
 * splash run concurrently — the splash is an overlay on a live app, never a gate in front of a dead
 * one. Timing lives in `useSplash`.
 */
export function App(): React.JSX.Element {
  useAppearance();
  useFileWatch();
  const hydrateCurrent = useWorkspaceStore((s) => s.hydrateCurrent);

  // Stable across renders so the splash hook does not re-run initialization on every store update.
  const initialize = useCallback(() => hydrateCurrent(), [hydrateCurrent]);
  const { state, retry, dismiss } = useSplash(initialize);

  return (
    <div aria-busy={state.visible} className="contents">
      <AppShell />
      {state.visible && (
        <SplashScreen
          phase={state.phase}
          message={state.message}
          errorMessage={state.errorMessage}
          onRetry={retry}
          onDismiss={dismiss}
        />
      )}
    </div>
  );
}
