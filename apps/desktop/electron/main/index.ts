import { join } from 'node:path';

import { providerDescriptor } from '@fixora/core-ai';
import { app, BrowserWindow } from 'electron';

import { createAiService } from './ai/ai-service.js';
import { safeStorageCipher } from './ai/cipher.js';
import { createCredentialStore } from './ai/credentials/credential-store.js';
import { createKeyStore } from './ai/key-store.js';
import { createModelCatalogue } from './ai/model-catalogue.js';
import { createProviderHealthStore } from './ai/provider-health-store.js';
import { createOrchestrator } from './ai/providers/orchestrator.js';
import { createProviderRegistry } from './ai/providers/provider-registry.js';
import { createAnalysisHost } from './analysis/analysis-host.js';
import { createAnalysisService } from './analysis/analysis-service.js';
import { createConsentStore } from './consent/consent-store.js';
import { openDatabase } from './db/database.js';
import {
  createFileIndexRepository,
  createFindingsRepository,
  createRepairHistoryRepository,
  createWorkspaceRepository,
} from './db/repositories.js';
import { registerAiHandlers } from './ipc/handlers/ai.handlers.js';
import { registerAnalysisHandlers } from './ipc/handlers/analysis.handlers.js';
import { registerConsentHandlers } from './ipc/handlers/consent.handlers.js';
import { registerEditorHandlers } from './ipc/handlers/editor.handlers.js';
import { registerGitHandlers } from './ipc/handlers/git.handlers.js';
import { registerLicenseHandlers } from './ipc/handlers/license.handlers.js';
import { registerPackageManagerHandlers } from './ipc/handlers/package-manager.handlers.js';
import { registerProceedHandlers } from './ipc/handlers/proceed.handlers.js';
import { registerProjectHandlers } from './ipc/handlers/project.handlers.js';
import { registerProviderHandlers } from './ipc/handlers/providers.handlers.js';
import { registerSearchHandlers } from './ipc/handlers/search.handlers.js';
import { registerSuggestionHandlers } from './ipc/handlers/suggestions.handlers.js';
import { registerSystemHandlers } from './ipc/handlers/system.handlers.js';
import { registerTerminalHandlers } from './ipc/handlers/terminal.handlers.js';
import { registerWindowHandlers } from './ipc/handlers/window.handlers.js';
import { registerWorkspaceHandlers } from './ipc/handlers/workspace.handlers.js';
import { assertEveryChannelIsHandled, mountRouter } from './ipc/router.js';
import { createLicenseService } from './license/license-service.js';
import { licensePublicKey } from './license/public-key.js';
import { createMailService } from './services/mail/mail-service.js';
import { migrateLegacyUserData } from './services/migrate-user-data.js';
import { createWorkspaceService } from './services/workspace-service.js';
import { createSuggestionRepository } from './suggestions/suggestion-repository.js';
import { createSuggestionService } from './suggestions/suggestion-service.js';
import { createSuggestionStorage } from './suggestions/suggestion-storage.js';
import { initAutoUpdater, registerUpdateHandlers } from './updater.js';
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

/**
 * The Windows Application User Model ID, which must match `appId` in electron-builder.yml.
 *
 * Windows keys a taskbar button to this string and uses it to tie a running process back to the
 * shortcut that launched it. Unset, Electron supplies its own default: the app gets a taskbar entry
 * that does not associate with its Start Menu shortcut and shows the generic Electron icon. Harmless
 * looking, and the reason a correctly branded shortcut can still pin as something else.
 *
 * Set before any window exists, because the association is read when the first one is created.
 */
if (process.platform === 'win32') app.setAppUserModelId('dev.fixora.app');

// `package.json`'s `name` is the scoped `@fixora/desktop`, which is what `app.getName()` would
// otherwise report — the packaged build's `productName: Fixora` doesn't reach an unpackaged/dev
// run. Setting it explicitly keeps dev and packaged runs consistent everywhere Electron surfaces
// the app name (window title fallback, `userData` path, crash reports).
app.setName('Fixora');

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
      /**
       * Say which build this is, first thing, on every launch.
       *
       * A defect fixed in source but absent from the installed binary is indistinguishable from a
       * defect that was never fixed — and the app could not previously tell you which it was
       * looking at. One line in the log now answers it, so "is this build current?" never again
       * costs an investigation.
       */
      console.error('[main] build', {
        commit: typeof __FIXORA_COMMIT__ === 'string' ? __FIXORA_COMMIT__ : 'unknown',
        builtAt: typeof __FIXORA_BUILT_AT__ === 'string' ? __FIXORA_BUILT_AT__ : 'unknown',
        dirty: typeof __FIXORA_DIRTY__ === 'boolean' ? __FIXORA_DIRTY__ : false,
        packaged: app.isPackaged,
        version: app.getVersion(),
      });

      // Recovers provider credentials orphaned by a pre-`app.setName` build's wrongly-named
      // userData dir (see the module doc). Must run before anything below opens `userData`.
      migrateLegacyUserData(app.getPath('appData'), app.getPath('userData'));

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
      // No cipher here any more: this store holds only the legacy model id, never a credential.
      const keyStore = createKeyStore({ dir: app.getPath('userData') });
      const repairHistory = createRepairHistoryRepository(driver);
      // Verification runs on its OWN worker (ADR-003 overlay), isolated from workspace analysis.
      const verificationHost = createAnalysisHost(join(__dirname, 'analysis-worker.mjs'));
      const verification = createVerificationService({ host: verificationHost });
      // The live OpenRouter catalogue. Public endpoint, no key — it is safe to consult before the
      // user has configured anything, and a failure to reach it never blocks launch.
      const modelCatalogue = createModelCatalogue();

      // The provider platform. Credentials, preferences and selection are three separate concerns
      // on purpose: secrets never enter the registry, and the orchestrator reads both without
      // owning either.
      const credentials = createCredentialStore({
        dir: app.getPath('userData'),
        cipher: safeStorageCipher,
      });
      const providerRegistry = createProviderRegistry({ dir: app.getPath('userData') });
      /**
       * Provider health, recorded from traffic that was going to happen anyway.
       *
       * In memory on purpose: health is a statement about right now, and persisting it would show
       * "Connected" on launch because it was connected yesterday — the exact false reassurance the
       * panel exists to remove. An empty store honestly reports "not checked".
       */
      const providerHealth = createProviderHealthStore({
        labelFor: (id) => providerDescriptor(id)?.label ?? id,
      });
      const orchestrator = createOrchestrator({
        registry: providerRegistry,
        credentials,
        // Per-model capability metadata, where the provider publishes it. OpenRouter does; nobody
        // else does, and `resolveCapabilities` falls back to the provider's declared guarantee.
        modelFacts: async (providerId, model) => {
          if (providerId !== 'openrouter') return null;
          const models = await modelCatalogue.models();
          return models.find((entry) => entry.id === model) ?? null;
        },
        // Smart model routing's catalogue source. Only meaningful for a provider left on "auto" —
        // see `orchestrator.ts` — so this has zero effect on any user who has picked a model, which
        // migration guarantees for every existing OpenRouter user.
        modelCatalogue: async (providerId) =>
          providerId === 'openrouter' ? modelCatalogue.models() : [],
        appMeta: { name: 'Fixora', url: 'https://fixora.dev' },
      });

      const aiService = createAiService({
        keyStore,
        // Observer only. The service calls these AFTER an outcome is decided; nothing in the repair
        // path reads health back, so a health write can never gate or delay a repair.
        health: providerHealth,
        findings: findingsRepo,
        workspace: workspaceService,
        verification,
        history: repairHistory,
        // Q2 Fix #2A: deterministic (`safe-auto`) repairs run in the analysis worker, the same one
        // verification uses — `deterministicRepair` needs the ESM + tree-sitter engine that cannot
        // load in this process. Mirrors exactly how Proceed's `resolveScope` is wired below.
        microRepair: (input) =>
          new Promise((resolve, reject) => {
            verificationHost.microRepair({
              id: `micro-${String(Date.now())}`,
              finding: input.finding,
              source: input.source,
              language: input.language,
              filePath: input.filePath,
              onResult: resolve,
              onError: (message) => {
                reject(new Error(message));
              },
            });
          }),
        appMeta: { name: 'Fixora', url: 'https://fixora.dev' },
        orchestrator,
      });

      // Licensing (Beta): offline Ed25519-verified entitlement. BYOK is free; a valid key is Pro.
      const license = createLicenseService({
        dir: app.getPath('userData'),
        publicKey: licensePublicKey(),
      });

      registerSystemHandlers({ workspace: workspaceService });
      registerWindowHandlers();
      registerWorkspaceHandlers(workspaceService);
      registerEditorHandlers(workspaceService, analysisHost);
      registerGitHandlers(workspaceService);
      registerAnalysisHandlers(analysisService);
      registerProviderHandlers({
        registry: providerRegistry,
        credentials,
        health: providerHealth,
        // A saved key must take effect on the NEXT repair, not the next launch: cancel any run
        // already issued against the previous credential so its verdict cannot land afterwards.
        onCredentialChange: () => {
          aiService.cancel();
        },
      });
      // First-run agreement. Registered before the AI handlers so the shell can ask on launch.
      registerConsentHandlers({
        consent: createConsentStore({ dir: app.getPath('userData') }),
      });

      registerAiHandlers({
        keyStore,
        credentials,
        registry: providerRegistry,
        aiService,
        workspace: workspaceService,
        history: repairHistory,
        catalogue: modelCatalogue,
      });
      // Proceed Mode (P2.2R). Reuses the SAME key store, verification service and findings the repair
      // path uses; scope selection runs on the verification worker (which owns tree-sitter). Applying
      // a Proceed edit goes through `ai:applyRepair` — the one verified write path.
      registerProceedHandlers({
        keyStore,
        orchestrator,
        workspace: workspaceService,
        findings: findingsRepo,
        verification,
        host: verificationHost,
        history: repairHistory,
        appMeta: { name: 'Fixora', url: 'https://fixora.dev' },
      });
      registerLicenseHandlers({ license });
      registerUpdateHandlers();
      registerTerminalHandlers(workspaceService);
      registerSearchHandlers(workspaceService);
      registerPackageManagerHandlers(workspaceService);
      registerProjectHandlers(workspaceService);

      // Suggestion System (Sprint F1, F1.1). Not workspace-scoped — feedback about Fixora itself, so
      // it is available whether or not a project is open, same as Settings. appVersion/platform are
      // injected so the share-email formatter (and the service around it) stays free of an Electron
      // import — the same reasoning `system:getAppInfo` follows for `app.getVersion()`.
      const suggestionService = createSuggestionService({
        repository: createSuggestionRepository(createSuggestionStorage(driver)),
        appVersion: app.getVersion(),
        platform: process.platform,
      });
      // MailService (Sprint F1.4): the one reusable way anything in Fixora opens a mailto: link.
      // Fully generic — no built-in recipient — so any future feature that needs to send mail takes
      // this same dependency rather than growing a second implementation.
      const mailService = createMailService();
      registerSuggestionHandlers(suggestionService, mailService, workspaceService);

      // NOT restored here.
      //
      // This used to call `workspaceService.restoreLast()` unconditionally, which silently opened
      // the most recent workspace on every launch — indexing it and making it the target of every
      // workspace-scoped query — regardless of the user's "Reopen last project on startup"
      // preference. That preference defaults to OFF and is the entire point of ADR-tracked
      // behaviour "fresh session by default: launch on Home, restore nothing". Main never read it:
      // `grep -rn reopenLastProject apps/desktop/electron/` returned nothing.
      //
      // The consequence was worse than a wrong default. A user who had explicitly opted out still
      // had their last project opened and analyzed, and anything asking "what are the findings?"
      // before opening a project got that project's findings — which reads as findings attributed
      // to the wrong workspace even though storage and retrieval are correctly scoped.
      //
      // Restore is the renderer's decision now: it owns the preference (ui-store) and asks for the
      // workspace through `workspace:open`, which authorizes it as a known recent. Main starts with
      // no workspace open, which is what "restore nothing" has always claimed to mean.
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

      // After the window exists: an update-available push with nowhere to land is just a dropped
      // event (see `initAutoUpdater`'s window lookup), and there is no reason to race launch for it.
      // Once per app run, not per window — the `activate` path below re-creates the window on
      // macOS without relaunching the process, and a second check on every dock click would spam
      // GitHub's release API for nothing.
      initAutoUpdater();

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
