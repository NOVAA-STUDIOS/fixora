import { join } from 'node:path';

import { app, BrowserWindow } from 'electron';

import { createAiService } from './ai/ai-service.js';
import { safeStorageCipher } from './ai/cipher.js';
import { createKeyStore } from './ai/key-store.js';
import { createAnalysisHost } from './analysis/analysis-host.js';
import { createAnalysisService } from './analysis/analysis-service.js';
import { openDatabase } from './db/database.js';
import {
  createFileIndexRepository,
  createFindingsRepository,
  createRepairHistoryRepository,
  createWorkspaceRepository,
} from './db/repositories.js';
import { registerAiHandlers } from './ipc/handlers/ai.handlers.js';
import { registerAnalysisHandlers } from './ipc/handlers/analysis.handlers.js';
import { registerLicenseHandlers } from './ipc/handlers/license.handlers.js';
import { registerSystemHandlers } from './ipc/handlers/system.handlers.js';
import { registerWindowHandlers } from './ipc/handlers/window.handlers.js';
import { registerWorkspaceHandlers } from './ipc/handlers/workspace.handlers.js';
import { assertEveryChannelIsHandled, mountRouter } from './ipc/router.js';
import { createLicenseService } from './license/license-service.js';
import { licensePublicKey } from './license/public-key.js';
import { createWorkspaceService } from './services/workspace-service.js';
import { createVerificationService } from './verification/verification-service.js';
import { createMainWindow } from './windows/main-window.js';

/**
 * App lifecycle.
 *
 * The single-instance lock is not politeness (TDD §3.1). It is load-bearing twice over: the
 * `fixora://` auth callback must be forwarded to the already-running window (M4), and two
 * processes writing one SQLite file is corruption (M2). Both of those are milestones away,
 * and both are impossible to retrofit into a process model that permits a second instance —
 * so the lock is here from the first commit.
 */

// Some Windows GPU drivers never composite the first frame of a frameless, deferred-show window to
// the screen: Chromium paints the DOM (verified — `#root` is fully populated) but the window keeps
// showing its background colour until a resize forces a recomposite. To the user that is a black
// screen on launch. Moving *compositing* to the CPU sidesteps the broken driver path while keeping
// GPU *rasterisation*, so Monaco stays fast. Scoped to Windows, where this class of bug lives; this
// switch must be set before the GPU process starts, hence at module load, before anything else.
if (process.platform === 'win32') {
  app.commandLine.appendSwitch('disable-gpu-compositing');
}

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  const devServerUrl = process.env['ELECTRON_RENDERER_URL'];

  app.on('second-instance', () => {
    const [existing] = BrowserWindow.getAllWindows();
    if (existing !== undefined) {
      if (existing.isMinimized()) existing.restore();
      existing.focus();
    }
  });

  app.whenReady().then(
    () => {
      // Local persistence. A corrupt DB degrades to "history unavailable" and never blocks
      // launch (DB §1) — `openDatabase` returns `recovered` rather than throwing.
      const { driver } = openDatabase({ dir: app.getPath('userData') });
      const workspaceService = createWorkspaceService({
        workspaces: createWorkspaceRepository(driver),
        files: createFileIndexRepository(driver),
      });

      // The analysis engine runs in an isolated utility process (ADR-017). The worker is emitted
      // next to the main bundle as ESM (it imports the ESM engine + loads tree-sitter WASM).
      const findingsRepo = createFindingsRepository(driver);
      const analysisHost = createAnalysisHost(join(__dirname, 'analysis-worker.mjs'));
      const analysisService = createAnalysisService({
        workspaces: workspaceService,
        findings: findingsRepo,
        host: analysisHost,
      });

      // AI (M5, BYOK). core-ai is pure and bundled into main (no WASM), so the provider call runs
      // direct from the main process with the user's keychain-stored key. The renderer never sees it.
      const keyStore = createKeyStore({ dir: app.getPath('userData'), cipher: safeStorageCipher });
      const repairHistory = createRepairHistoryRepository(driver);
      // Verification runs on its OWN worker (ADR-003 overlay), isolated from workspace analysis.
      const verificationHost = createAnalysisHost(join(__dirname, 'analysis-worker.mjs'));
      const verification = createVerificationService({ host: verificationHost });
      const aiService = createAiService({
        keyStore,
        findings: findingsRepo,
        workspace: workspaceService,
        verification,
        history: repairHistory,
        appMeta: { name: 'Fixora', url: 'https://fixora.dev' },
      });

      // Licensing (Beta): offline Ed25519-verified entitlement. BYOK is free; a valid key is Pro.
      const license = createLicenseService({
        dir: app.getPath('userData'),
        publicKey: licensePublicKey(),
      });

      registerSystemHandlers();
      registerWindowHandlers();
      registerWorkspaceHandlers(workspaceService);
      registerAnalysisHandlers(analysisService);
      registerAiHandlers({ keyStore, aiService, workspace: workspaceService, history: repairHistory });
      registerLicenseHandlers({ license });

      // Reopen the last workspace (if its folder still exists), like an IDE restoring your project.
      // Off the critical path — a failure here never blocks launch.
      try {
        workspaceService.restoreLast();
      } catch {
        // nothing to restore, or the folder is gone — start on the "open folder" screen.
      }
      // Fail fast, at startup, if any declared channel has no handler — before a window
      // exists to send it a request (Standards §2).
      assertEveryChannelIsHandled();
      mountRouter();

      app.on('will-quit', () => {
        analysisHost.dispose();
        verification.dispose();
        driver.close();
      });

      createMainWindow(devServerUrl);

      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
          createMainWindow(devServerUrl);
        }
      });
    },
    (error: unknown) => {
      console.error('[main] failed to start', error);
      app.quit();
    },
  );

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  /**
   * A renderer process that dies takes its window with it, not the app. From M2 that window
   * may hold unsaved work, so the recovery path is a milestone-2 concern — but the listener
   * exists now so the failure is visible in logs rather than silent.
   */
  app.on('render-process-gone', (_event, _webContents, details) => {
    console.error('[main] renderer process gone', { reason: details.reason });
  });

  app.on('child-process-gone', (_event, details) => {
    console.error('[main] child process gone', { type: details.type, reason: details.reason });
  });
}
