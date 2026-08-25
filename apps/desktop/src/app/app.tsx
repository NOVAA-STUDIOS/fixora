import { useCallback, useEffect, useState } from 'react';

import { useAuthStore } from '../features/auth/auth-store.js';
import { LoginScreen } from '../features/auth/login-screen.js';
import { FeedbackDialog } from '../features/feedback/feedback-dialog.js';
import { useFeedbackStore } from '../features/feedback/feedback-store.js';
import { BulkCascadingDialog } from '../features/findings/bulk-cascading-dialog.js';
import { useBulkRepairStore } from '../features/findings/bulk-repair-store.js';
import { UpgradeDialog } from '../features/license/upgrade-dialog.js';
import { OnboardingModal } from '../features/onboarding/onboarding-modal.js';
import { ShareDialog } from '../features/sharing/share-dialog.js';
import { AppShell } from '../features/shell/app-shell.js';
import { SplashScreen } from '../features/shell/splash-screen.js';
import { useSplash } from '../features/shell/use-splash.js';
import { ShortcutsPanel } from '../features/shortcuts/shortcuts-panel.js';
import { useFileWatch } from '../features/workspace/use-file-watch.js';
import { useWorkspaceStore } from '../features/workspace/workspace-store.js';
import { useAppearance } from '../hooks/use-appearance.js';
import { waitForAppReady } from '../lib/app-ready.js';
import { invoke } from '../lib/bridge.js';
import { useAiStore } from '../stores/ai-store.js';
import {
  listenForPlanRevoked,
  listenForRevalidation,
  useLicenseStore,
} from '../stores/license-store.js';
import { useOnboardingStore } from '../stores/onboarding-store.js';
import { useShareStore } from '../stores/share-store.js';
import { useShortcutsStore } from '../stores/shortcuts-store.js';

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
    console.error('[app] effect running:', 'getSession');
    void getSession();
  }, [getSession]);

  // Waits for `app:ready` — main starts loading this window before constructing its services, so
  // an `invoke` fired the instant the renderer mounts could otherwise race a handler that doesn't
  // exist yet — then restores the workspace. The splash covers exactly this wait.
  const initialize = useCallback(
    () => waitForAppReady().then(() => hydrateCurrent()),
    [hydrateCurrent],
  );
  const splash = useSplash(initialize);

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

  // The findings panel reads `config?.configured` to choose Repair vs. "Set up AI to repair", but
  // nothing fetched it until the user separately opened the AI panel or Settings — so it showed
  // "Set up AI" indefinitely on the screen the user actually lands on first. Fetched here once, at
  // real app mount, independent of the splash for the same reason `version` above is.
  const loadConfig = useAiStore((s) => s.loadConfig);
  useEffect(() => {
    console.error('[app] effect running:', 'loadConfig');
    void loadConfig();
  }, [loadConfig]);

  // Main emits this at startup when it holds no paid plan for this device; the renderer still has
  // the license key, so it can restore the plan without the user doing anything.
  useEffect(() => listenForRevalidation(), []);
  useEffect(() => listenForPlanRevoked(), []);

  // Main owns the repair count; this store's copy is display only. Synced once at startup so the
  // first paint shows the real number rather than whatever localStorage last held.
  const syncLicenseFromMain = useLicenseStore((s) => s.syncFromMain);
  useEffect(() => {
    void waitForAppReady().then(() => syncLicenseFromMain());
  }, [syncLicenseFromMain]);

  // Open-state for the always-listed-but-rarely-open root dialogs below — read here so each one
  // mounts (and subscribes to its own store) only while actually shown, instead of on every render.
  const showUpgradeDialog = useLicenseStore((s) => s.showUpgradeDialog);
  const cascadingPauseActive = useBulkRepairStore((s) => s.cascadingPause !== null);
  const feedbackOpen = useFeedbackStore((s) => s.open);
  const hasSeenOnboarding = useOnboardingStore((s) => s.hasSeenOnboarding);
  const shareOpen = useShareStore((s) => s.open);

  // '?' opens the shortcuts reference from anywhere, same as the command palette's global listener
  // — but a bare '?' must never fire while the user is typing it into a field (a commit message, a
  // comment, a search box), so it is ignored whenever the event originates in an editable element.
  const openShortcuts = useShortcutsStore((s) => s.open);
  const shortcutsOpen = useShortcutsStore((s) => s.isOpen);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== '?') return;
      const target = event.target;
      const inEditable =
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT');
      if (inEditable) return;
      event.preventDefault();
      openShortcuts();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [openShortcuts]);

  return (
    <>
      <AppShell />
      {showUpgradeDialog && <UpgradeDialog />}
      {/* Root-level: a paused bulk repair must stay answerable even if the Group Repair panel
          that started it has been closed. */}
      {cascadingPauseActive && <BulkCascadingDialog />}
      {feedbackOpen && <FeedbackDialog />}
      {!hasSeenOnboarding && <OnboardingModal />}
      {shortcutsOpen && <ShortcutsPanel />}
      {shareOpen && <ShareDialog />}
      {showSignIn && <LoginScreen />}
      {splash.visible && <SplashScreen phase={splash.phase} version={version} />}
    </>
  );
}
