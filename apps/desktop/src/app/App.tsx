import { useCallback, useEffect, useState } from 'react';

import { AppShell } from '../features/shell/app-shell.js';
import { SplashScreen } from '../features/shell/splash-screen.js';
import { useSplash } from '../features/shell/use-splash.js';
import { useFileWatch } from '../features/workspace/use-file-watch.js';
import { useWorkspaceStore } from '../features/workspace/workspace-store.js';
import { useAppearance } from '../hooks/use-appearance.js';
import { invoke } from '../lib/bridge.js';

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
  // The stage callback lets the launch screen report work that actually happened.
  const initialize = useCallback(
    (onStage?: (stage: string) => void) =>
      hydrateCurrent((stage) => {
        onStage?.(stage);
      }),
    [hydrateCurrent],
  );
  const { state, retry, dismiss } = useSplash(initialize);

  // Fetched independently of `initialize` — the splash's closing timing must never wait on this,
  // it only fills in a line of the screen if it arrives while the splash is still up.
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void invoke('system:getAppInfo', {}).then((r) => {
      if (!cancelled && r.ok) setVersion(r.value.version);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div aria-busy={state.visible} className="contents">
      {/* `inert` while the splash is up: the splash is a plain overlay div, not a Radix dialog, so
          nothing else stops a keyboard/screen-reader user from tabbing into the fully interactive
          (but visually covered) shell behind it — worst in the error state, which never
          auto-dismisses. `inert` removes the whole subtree from both the tab order and the
          accessibility tree, and blocks pointer events, until the splash is gone. (Beta audit A1,
          Splash Screen finding 1 / Keyboard Navigation finding 1.) */}
      <div className="contents" inert={state.visible}>
        <AppShell />
      </div>
      {state.visible && (
        <SplashScreen
          phase={state.phase}
          message={state.message}
          working={state.working}
          errorMessage={state.errorMessage}
          version={version}
          onRetry={retry}
          onDismiss={dismiss}
        />
      )}
    </div>
  );
}
