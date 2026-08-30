import { join, resolve } from 'node:path';

import { providerDescriptor } from '@fixora/core-ai';
import { app, BrowserWindow, Menu } from 'electron';
import log from 'electron-log';

console.error('[main] process started, pid:', process.pid);

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
import { createGpuPreferenceStore } from './gpu-preference-store.js';
import { emitToWindow } from './ipc/emit.js';
import { registerAiHandlers } from './ipc/handlers/ai.handlers.js';
import { registerAnalysisHandlers } from './ipc/handlers/analysis.handlers.js';
import { registerAuthHandlers } from './ipc/handlers/auth.handlers.js';
import { registerConsentHandlers } from './ipc/handlers/consent.handlers.js';
import { registerEditorHandlers } from './ipc/handlers/editor.handlers.js';
import { registerGitHandlers } from './ipc/handlers/git.handlers.js';
import { registerHookHandlers } from './ipc/handlers/hook.handlers.js';
import { registerLicenseHandlers } from './ipc/handlers/license.handlers.js';
import { registerMcpHandlers } from './ipc/handlers/mcp.handlers.js';
import { registerNotificationHandlers } from './ipc/handlers/notifications.handlers.js';
import { registerPackageManagerHandlers } from './ipc/handlers/package-manager.handlers.js';
import { registerPreviewHandlers } from './ipc/handlers/preview.handlers.js';
import { registerProceedHandlers } from './ipc/handlers/proceed.handlers.js';
import { registerProjectHandlers } from './ipc/handlers/project.handlers.js';
import { registerProviderHandlers } from './ipc/handlers/providers.handlers.js';
import { registerReferralHandlers } from './ipc/handlers/referral.handlers.js';
import { registerSearchHandlers } from './ipc/handlers/search.handlers.js';
import { registerShieldHandlers } from './ipc/handlers/shield.handlers.js';
import { registerSuggestionHandlers } from './ipc/handlers/suggestions.handlers.js';
import { registerSystemHandlers } from './ipc/handlers/system.handlers.js';
import { registerTerminalHandlers } from './ipc/handlers/terminal.handlers.js';
import { registerTestGenerationHandlers } from './ipc/handlers/test-generation.handlers.js';
import { registerWindowHandlers } from './ipc/handlers/window.handlers.js';
import { registerWorkspaceHandlers } from './ipc/handlers/workspace.handlers.js';
import { assertEveryChannelIsHandled, mountRouter, registerHandler } from './ipc/router.js';
import { revalidateIfDue } from './lib/gumroad-revalidate.js';
import { checkAndRecordLaunchedVersion } from './lib/last-launched-version.js';
import { initMcpSetting } from './lib/mcp-setting.js';
import { getPlan } from './lib/repair-limit.js';
import { initShieldSettings } from './lib/shield-settings.js';
import { isMcpOnlyLaunch, startMcpOnly } from './mcp-standalone.js';
import { createMailService } from './services/mail/mail-service.js';
import { migrateLegacyUserData } from './services/migrate-user-data.js';
import { createPreviewService } from './services/preview-service.js';
import { createShieldService } from './services/shield/shield-service.js';
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
// GPU *rasterisation*, so Monaco stays fast — but it costs every OTHER user's rendering smoothness,
// so it is no longer applied unconditionally. Per-machine decision via `gpuPreference`: try WITH
// compositing by default; a launch that never reaches the renderer's first paint before the app
// exits (crash or hang — the same failure mode a black screen is a symptom of) is auto-detected on
// the NEXT launch and flips the flag from then on. A user who still sees a black screen despite
// that can flip it manually in Settings. Scoped to Windows, where this class of bug lives; the
// switch must be set before the GPU process starts, hence at module load, before anything else.
// GPU rasterisation, unconditionally — separate from the compositing workaround above (which the
// broken-driver path sidesteps by moving to the CPU) and unaffected by it either way, so this is
// not gated on `gpuPreference`. Must also be set before the GPU process starts, same as the switch
// below.
app.commandLine.appendSwitch('enable-gpu-rasterization');

/** Whether the stdio MCP server actually started this launch — read by `mcp:getSetting` so the
 *  settings toggle and status bar can distinguish "enabled" from "running right now". Set by
 *  `mcp-standalone.ts`, the only thing that starts the server. */
let mcpRunning = false;

/** Set once `startBackend` has constructed every service and registered every handler. Polled by
 *  the renderer via `app:getReadyState` (`app-ready.ts`) — a pull, so there is no listener to race. */
let backendReady = false;

export function markMcpRunning(): void {
  mcpRunning = true;
}

export const gpuPreference =
  process.platform === 'win32' ? createGpuPreferenceStore(app.getPath('userData')) : null;
if (gpuPreference !== null) {
  if (gpuPreference.shouldDisableCompositing()) {
    app.commandLine.appendSwitch('disable-gpu-compositing');
    log.info('[gpu] compositing disabled (previous launch failed to render, or user setting)');
  } else {
    gpuPreference.markLaunchPending();
    log.info('[gpu] compositing enabled (default path)');
  }
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

// No menu bar exists in this app by design (frame: false, a custom title bar owns every control) —
// but Electron still creates its own default application menu unless told not to, with role items
// (Copy/Paste/Reload/Toggle DevTools) whose accelerators stay live even with the bar auto-hidden.
// One of those built-in role handlers is the actual source of "getAllWebContents is not a
// function" — nothing in this codebase calls that API. Clearing the menu removes the trigger.
Menu.setApplicationMenu(null);

// Supabase OAuth completes in the system browser, which redirects back here via a custom
// protocol (`fixora://auth/callback#access_token=...`) rather than a normal window navigation.
// Must be registered before `whenReady`, same as the GPU switches above.
//
// Packaged builds are one exe — no args needed. An unpackaged dev run is `electron.exe` plus
// this project's entry script as an argument; without passing both explicitly, Windows registers
// the protocol against bare `electron.exe` with no idea which app to launch, so the OAuth
// redirect opens an unrelated Electron process instead of this one. Always re-registered (not
// guarded on `isDefaultProtocolClient`) so a stale registry entry from an earlier dev session —
// pointing at a since-moved `electron.exe` — can never linger.
if (app.isPackaged) {
  app.setAsDefaultProtocolClient('fixora');
} else {
  app.setAsDefaultProtocolClient('fixora', process.execPath, [resolve(process.argv[1] ?? '')]);
}

/**
 * Auth callbacks now handled via loopback HTTP (RFC 8252 PKCE) — `auth.handlers.ts`'s loopback
 * server completes the whole OAuth exchange itself, so a `fixora://auth/callback` activation
 * reaching this app has nothing left to do. Kept as a named no-op (not deleted) since `fixora://`
 * stays registered below and this is still where any future use of it would be dispatched from.
 */
function forwardAuthCallback(url: string): void {
  if (!url.startsWith('fixora://auth/callback')) return;
  console.error('[auth] fixora://auth/callback received but ignored — handled via loopback HTTP (RFC 8252 PKCE)');
}

// MCP-only mode is decided BEFORE the lock is even requested.
//
// Asking for the lock is what breaks this case: an MCP client spawning `Fixora.exe --mcp` while the
// GUI is open would fail to acquire it and quit, and the client would see a pipe that closed
// without a word. A headless MCP process is not a second copy of the app competing for a window —
// it is a child the client owns — so it does not participate in the lock at all.
if (isMcpOnlyLaunch()) {
  startMcpOnly(startBackend, markMcpRunning);
} else {
  const gotTheLock = app.requestSingleInstanceLock();
  // Logged because the whole protocol-callback path depends on it: the instance that HOLDS the lock
  // is the one that receives `second-instance`, and the one that does not is the one carrying the
  // `fixora://` URL. If a callback never arrives, this line says which side this process was on.
  console.error('[auth] single-instance lock', {
    acquired: gotTheLock,
    launchedWithProtocolUrl: process.argv.some((arg) => arg.startsWith('fixora://')),
  });
  if (!gotTheLock) {
    // Electron has already forwarded this process's argv (including the `fixora://` URL) to the
    // primary instance as part of `requestSingleInstanceLock()`, so quitting here loses nothing.
    app.quit();
  } else {
    const devServerUrl = process.env['ELECTRON_RENDERER_URL'];

    // Windows/Linux: a protocol launch while the app is already running arrives as a second
    // instance, the URL as a command-line argument — not as `open-url` (macOS-only).
    app.on('second-instance', (_event, argv) => {
      // Searched across the WHOLE argv, never assumed at a fixed index: a dev run is
      // `electron.exe <entryScript> fixora://…` while a packaged one is `Fixora.exe fixora://…`, so
      // the URL's position differs by build.
      const url = argv.find((arg) => arg.startsWith('fixora://'));
      // Never log `argv` itself — it contains the callback URL, and that URL carries a live
      // `access_token`. Logging it would write a working credential into electron-log's on-disk
      // file, where it outlives the session it belongs to.
      console.error('[auth] second-instance received', {
        argCount: argv.length,
        hasProtocolUrl: url !== undefined,
      });
      const [existing] = BrowserWindow.getAllWindows();
      if (existing !== undefined) {
        if (existing.isMinimized()) existing.restore();
        existing.focus();
      }
      if (url !== undefined) forwardAuthCallback(url);
    });

    app.on('open-url', (event, url) => {
      // Same reason as above: the URL is a credential, so only its shape is recorded.
      console.error('[auth] open-url received', { hasProtocolUrl: url.startsWith('fixora://') });
      event.preventDefault();
      forwardAuthCallback(url);
    });

    app.whenReady().then(
      () => {
        // Window first, everything else after. `createMainWindow` only builds a `BrowserWindow` and
        // starts it loading the renderer bundle (`show: false` until `ready-to-show`) — it depends
        // on nothing below. DB open, migrations, and every service/handler construction run inside
        // the `setImmediate` below instead, so Chromium gets the event-loop turn it needs to
        // actually create the window and start loading the renderer before main goes on to do its
        // own heavy synchronous setup. The renderer's splash covers this wait and closes once
        // `app:ready` fires below.
        const window = createMainWindow(devServerUrl, () => gpuPreference?.markLaunchConfirmed());

        app.on('activate', () => {
          if (BrowserWindow.getAllWindows().length === 0) {
            createMainWindow(devServerUrl);
          }
        });

        setImmediate(() => {
          startBackend(window);
        });

        // COLD START: if the app was NOT already running, the OS launches it with the `fixora://`
        // URL in this instance's own argv — `second-instance` never fires (there is no second
        // instance) and `open-url` is macOS-only. That callback was previously dropped entirely.
        // Deferred to the renderer's own `app:ready` handshake: `emitToWindow` reaches a window that
        // exists but whose renderer has not yet subscribed, and the event would land on nothing.
        const launchUrl = process.argv.find((arg) => arg.startsWith('fixora://'));
        if (launchUrl !== undefined) {
          console.error('[auth] callback present in launch argv (cold start)');
          window.webContents.once('did-finish-load', () => {
            forwardAuthCallback(launchUrl);
          });
        }
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
     * exists now so the failure is visible in logs rather than silent. `electron-log`, not
     * `console.error`: a packaged build has no attached console, so that line would otherwise
     * exist nowhere a user could ever hand back to us.
     */
    app.on('render-process-gone', (_event, _webContents, details) => {
      log.error('[main] renderer process gone', { reason: details.reason });
    });

    app.on('child-process-gone', (_event, details) => {
      log.error('[main] child process gone', { type: details.type, reason: details.reason });
    });
  }
}

/**
 * Everything the window itself does not need: DB open + migrations, every service, every IPC
 * handler registration, and the router mount. Deferred one tick past window creation (see the
 * comment at its call site) so the window exists and has started loading before any of this
 * synchronous work runs. Emits `app:ready` once done — the renderer's splash waits for it before
 * making any real IPC call, so nothing races a handler that main hasn't registered yet.
 */
function startBackend(window: BrowserWindow | null): void {
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

  // Read (and overwrite) the last-launched version now, before anything else touches userData —
  // whether the What's New modal fires depends only on comparing versions, never on load order.
  const { previousVersion } = checkAndRecordLaunchedVersion(app.getPath('userData'), app.getVersion());

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

  // Polled by the renderer's splash instead of pushed — see `backendReady` above.
  registerHandler('app:getReadyState', () => ({ ready: backendReady }));
  registerSystemHandlers({ workspace: workspaceService, gpuPreference });
  registerLicenseHandlers({ driver, dir: app.getPath('userData') });
  registerReferralHandlers({ driver });
  registerAuthHandlers();
  registerWindowHandlers();
  registerWorkspaceHandlers(workspaceService);
  registerEditorHandlers(workspaceService, analysisHost);
  registerGitHandlers(workspaceService);
  // Started unconditionally — the "Fixora will detect it automatically" promise (the empty-state
  // copy in preview-panel.tsx) means the scan has to already be running before the user ever opens
  // Preview, not begin only once they do. A background `GET /` every 3s to a handful of localhost
  // ports is cheap enough to run for the life of the session.
  const previewService = createPreviewService(window);
  registerPreviewHandlers(previewService);
  previewService.startScanning();
  registerHookHandlers(workspaceService);
  registerAnalysisHandlers(analysisService, workspaceService);
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
  registerTestGenerationHandlers({ workspace: workspaceService, orchestrator });
  registerNotificationHandlers();
  // Code Shield: reads only — it re-runs the analyzers already wired above and reports what they
  // found. Registered with the same services the Problems panel uses, so the two cannot disagree.
  initShieldSettings(app.getPath('userData'));
  registerShieldHandlers({
    shield: createShieldService({
      workspace: workspaceService,
      analysis: analysisService,
      findings: findingsRepo,
    }),
    workspace: workspaceService,
  });
  initMcpSetting(app.getPath('userData'));
  registerMcpHandlers({
    workspace: workspaceService,
    findings: findingsRepo,
    analysis: analysisService,
    registry: providerRegistry,
    credentials,
    isRunning: () => mcpRunning,
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
  console.error('[startup] handlers registered');

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

  // Embedded MCP server (feature #10) — BOTH conditions, never either alone.
  //
  // The flag says "this launch is meant to serve MCP" (Claude Desktop's spawned command, per
  // mcp-config-example.json). The setting says "the user agreed to that at all". A flag on its own
  // is not consent: anything able to spawn this executable can pass one, and a connected MCP client
  // can rewrite whatever project is open with none of the review-then-Apply gating the UI enforces.
  // Default is off (`mcp-setting.ts`).
  // The MCP server is NOT started here.
  //
  // It used to be, gated on `--mcp` — but that flag now routes the whole launch to
  // `mcp-standalone.ts` before the lock is even requested, and that module calls this function to
  // build the backend before starting the server itself. Starting it here too would attach a second
  // readline listener to the same stdin and answer every JSON-RPC request twice.

  app.on('will-quit', () => {
    analysisHost.dispose();
    verification.dispose();
    driver.close();
  });

  // After handlers exist: an update-available push with nowhere to land is just a dropped
  // event (see `initAutoUpdater`'s window lookup), and there is no reason to race launch for
  // it. Once per app run, not per window — the `activate` handler (registered at the window's
  // own creation, above) re-creates the window on macOS without relaunching the process, and a
  // second check on every dock click would spam GitHub's release API for nothing.
  initAutoUpdater();

  // Backend fully constructed and every handler registered — `app:getReadyState` now answers
  // `{ ready: true }`, which is what the renderer's splash polls before making any real IPC call.
  backendReady = true;

  // Only when a previous launch actually recorded a DIFFERENT version — never on a fresh install
  // (`previousVersion === null`) and never on a same-version relaunch.
  const currentVersion = app.getVersion();
  if (
    previousVersion !== null &&
    previousVersion !== currentVersion &&
    window !== null &&
    !window.isDestroyed()
  ) {
    emitToWindow(window, 'app:justUpdated', { previousVersion, currentVersion });
  }

  // Main is the authority on the plan now, but it only learns one from a successful
  // `license:validate`. A user who activated before that moved main-side has their key in the
  // renderer and nothing here — ask for a re-validation rather than silently metering them as free.
  if (getPlan() === 'free' && window !== null && !window.isDestroyed()) {
    emitToWindow(window, 'license:revalidateNeeded', {});
  }

  // Periodic licence re-check, fire-and-forget: it makes a network call, and startup must never
  // wait on Gumroad being reachable. Only a definitive rejection changes anything (see
  // `gumroad-revalidate.ts`), so the offline case is a no-op rather than a downgrade.
  void revalidateIfDue().then((outcome) => {
    if (outcome !== 'revoked') return;
    if (window !== null && !window.isDestroyed()) {
      emitToWindow(window, 'license:planRevoked', {});
    }
  });

  // A renderer that is alive but not pumping its message loop — the actual "(Not Responding)"
  // state — is a DIFFERENT signal than either event above (both fire only once the process is
  // gone). `unresponsive`/`responsive` are per-window, not per-app; attached in `main-window.ts`,
  // next to `ready-to-show`, so every window this app creates gets the same coverage.
}
