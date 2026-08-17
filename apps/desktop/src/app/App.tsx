import { useCallback, useEffect, useState } from 'react';

import { useAuthStore } from '../features/auth/auth-store.js';
import { LoginScreen } from '../features/auth/login-screen.js';
import { UpgradeDialog } from '../features/license/upgrade-dialog.js';
import { AppShell } from '../features/shell/app-shell.js';
import { SplashScreen } from '../features/shell/splash-screen.js';
import { useSplash } from '../features/shell/use-splash.js';
import { useFileWatch } from '../features/workspace/use-file-watch.js';
import { useWorkspaceStore } from '../features/workspace/workspace-store.js';
import { useAppearance } from '../hooks/use-appearance.js';
import { invoke } from '../lib/bridge.js';
import { useAiStore } from '../stores/ai-store.js';

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

  // Sign-in is optional (only repair and purchase need it — the license gate checks it
  // separately) — the app is never blocked waiting for this to resolve.
  const showSignIn = useAuthStore((s) => s.showSignIn);
  const getSession = useAuthStore((s) => s.getSession);
  useEffect(() => {
    void getSession();
  }, [getSession]);

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

  // The findings panel reads `config?.configured` to choose Repair vs. "Set up AI to repair", but
  // nothing fetched it until the user separately opened the AI panel or Settings — so it showed
  // "Set up AI" indefinitely on the screen the user actually lands on first. Fetched here once, at
  // real app mount, independent of the splash for the same reason `version` above is.
  const loadConfig = useAiStore((s) => s.loadConfig);
  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

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
        <UpgradeDialog />
        {showSignIn && <LoginScreen />}
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
