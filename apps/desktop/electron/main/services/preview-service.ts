import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { get as httpGet } from 'node:http';
import { join } from 'node:path';

import { app, session, WebContentsView, type BrowserWindow, type Rectangle } from 'electron';

import { emitToWindow } from '../ipc/emit.js';

import type { WorkspaceService } from './workspace-service.js';

/**
 * Fixora Preview: an embedded `WebContentsView` showing the user's own localhost dev server,
 * side by side with the code. Two things keep it from being a general-purpose embedded browser
 * rather than a dev-server preview: it only ever loads `localhost`/`127.0.0.1`/`::1`, and every
 * navigation away from that (`will-navigate`, `window.open`) is blocked — the same containment
 * discipline `navigation-guard.ts` applies to the main window, scoped to this one instead.
 *
 * A separate, sandboxed session partition (`persist:fixora-preview`) — the dev server is the
 * user's own code, but a compromised dependency serving on that port is still untrusted content,
 * and it must never be able to reach anything the main window's session can.
 */

const COMMON_PORTS = [
  3000, 5173, 8080, 4200, 8000, 3001, 4000, 8888, 5174, 5175, 3002, 3003, 8081, 8082, 4321,
];
const FRAMEWORK_HINTS: Record<number, string> = {
  5173: 'Vite',
  3000: 'Next.js / React',
  4200: 'Angular',
  8080: 'Generic',
  8000: 'Python',
};

/** Framework default dev-server ports, guessed from the dev command's own text — probed first
 *  during the poll loop, before a full `COMMON_PORTS` scan. */
const FRAMEWORK_DEFAULT_PORTS: Record<string, number> = {
  vite: 5173,
  next: 3000,
  'react-scripts': 3000,
  angular: 4200,
  nuxt: 3000,
};

function guessPortFromCommand(cmd: string): number | null {
  for (const [key, port] of Object.entries(FRAMEWORK_DEFAULT_PORTS)) {
    if (cmd.toLowerCase().includes(key)) return port;
  }
  return null;
}

const SCAN_INTERVAL_MS = 3000;
// Some servers are slow to respond to the very first request.
const PROBE_TIMEOUT_MS = 1000;
/** Delay before the first scan — well after terminal handlers are registered, so startup (DB,
 *  handler registration, terminal availability) finishes before network probing begins. */
const SCAN_START_DELAY_MS = 5000;
/** How long `launchAndPreview` waits for the spawned dev server to start listening before giving up. */
const LAUNCH_TIMEOUT_MS = 30_000;
const LAUNCH_POLL_INTERVAL_MS = 500;
/** npm/yarn/pnpm install can be slow on a cold cache. */
const INSTALL_TIMEOUT_MS = 120_000;
const DEFAULT_BOUNDS: Rectangle = { x: 0, y: 0, width: 800, height: 600 };

export type DetectedServer = { port: number; url: string; framework: string };

// Fixora's own Vite dev server port — never treat as a user's dev server.
let fixoraDevPort: number | null = null;

export function setFixoraDevPort(port: number): void {
  fixoraDevPort = port;
}

export interface PreviewService {
  scanForDevServer(): Promise<DetectedServer | null>;
  startScanning(): void;
  stopScanning(): void;
  createView(bounds: Rectangle): void;
  destroyView(): void;
  resizeView(bounds: Rectangle): void;
  /** Hides the view without destroying it — switching away from the Preview tab. */
  hideView(): void;
  /** Reverses `hideView()` — switching back to the Preview tab. */
  showView(): void;
  loadUrl(url: string): void;
  refresh(): void;
  goBack(): void;
  goForward(): void;
  getState(): { url: string | null; isOpen: boolean; port: number | null };
  /** Called by `workspace.handlers.ts` after a successful `fs:writeFile` — refreshes the preview
   *  if one is currently open, a no-op otherwise. */
  notifyFileSaved(): void;
  /** Does the open workspace's package.json declare a `dev` script? `command` is the one to run
   *  it — the package manager the project actually uses, not always npm. */
  checkDevScript(): Promise<{ hasScript: boolean; command: string | null }>;
  /**
   * Confirms there is a real `dev` script to run. The command itself is handed back to the
   * renderer, not spawned here: main has no renderer-side terminal state to drive directly, and
   * the one place a foreground shell command is actually created is `useTerminalStore`'s
   * `openWithCommand` (the same path Package Manager's install/uninstall already uses) — this
   * only confirms there is something real for that call to run.
   */
  launchDevServer(): Promise<{ ok: boolean; error?: string }>;
  /**
   * Spawns the workspace's `dev` script as a hidden background process (no terminal), then polls
   * for it to start listening and opens it in the embedded view once it does. Already-running is
   * handled the same as a cold start — the poll's first pass finds it immediately, no process
   * spawned redundantly.
   */
  launchAndPreview(devCommand: string): Promise<{ ok: boolean; error?: string }>;
  /** App-quit cleanup: kills the spawned dev server (if any), stops scanning, tears down the view. */
  dispose(): void;
  /** Kills the spawned dev server (if any), without touching the view. */
  stopDevProcess(): void;
}

type PackageManager = 'pnpm' | 'yarn' | 'npm';

function detectPackageManager(root: string): PackageManager {
  if (existsSync(join(root, 'pnpm-lock.yaml'))) return 'pnpm';
  if (existsSync(join(root, 'yarn.lock'))) return 'yarn';
  return 'npm';
}

function devCommandFor(pm: PackageManager): string {
  return pm === 'npm' ? 'npm run dev' : `${pm} dev`;
}

/** One GET, resolved `true`/`false` — never rejects, so a dead port is just "not up", not an
 *  unhandled promise. Tries both `127.0.0.1` and `localhost` — Windows sometimes only answers on
 *  one of the two. */
function probePort(port: number): Promise<boolean> {
  const tryHost = (host: string): Promise<boolean> =>
    new Promise((resolve) => {
      const req = httpGet({ host, port, path: '/', timeout: PROBE_TIMEOUT_MS }, (res) => {
        res.resume(); // drain, so the socket can close instead of leaking
        // Accept any response (200, 301, 302, 404 all mean a server is up); only a 5xx or no
        // status at all means nothing real answered.
        resolve(res.statusCode !== undefined && res.statusCode < 500);
      });
      req.on('timeout', () => {
        req.destroy();
        resolve(false);
      });
      req.on('error', () => {
        resolve(false);
      });
    });

  return Promise.any([tryHost('127.0.0.1'), tryHost('localhost')]).catch(() => false);
}

/** First `COMMON_PORTS` entry that answers, in the array's own priority order — not necessarily
 *  the fastest to respond, so two dev servers running at once resolve deterministically. Probed
 *  in parallel (each still bounded by `PROBE_TIMEOUT_MS`), so a full scan costs one timeout's
 *  worth of wall-clock time, not one per port. */
async function scanPorts(): Promise<DetectedServer | null> {
  const results = await Promise.all(
    COMMON_PORTS.filter((port) => port !== fixoraDevPort).map((port) =>
      probePort(port).then((ok) => (ok ? port : null)),
    ),
  );
  const found = results.find((port) => port !== null);
  if (found === undefined) return null;
  return { port: found, url: `http://localhost:${String(found)}`, framework: FRAMEWORK_HINTS[found] ?? 'Generic' };
}

/** `null` when there is no real window to attach a view to (the `--mcp` standalone launch,
 *  which still calls `startBackend` — see index.ts). Every window-touching operation becomes a
 *  no-op rather than a crash; the channels still need handlers either way (router.ts's
 *  `assertEveryChannelIsHandled`). */
export function createPreviewService(
  window: BrowserWindow | null,
  workspace: WorkspaceService,
): PreviewService {
  let view: WebContentsView | null = null;
  let currentUrl: string | null = null;
  let currentPort: number | null = null;
  let scanTimer: ReturnType<typeof setInterval> | null = null;
  let scanStartTimer: ReturnType<typeof setTimeout> | null = null;
  let devProcess: ChildProcess | null = null;
  // Guards against a double-launch race — e.g. two rapid "Open Preview" clicks.
  let launching = false;
  // Set by createView/destroyView — the race guard for FIX 1's delayed stdout-triggered open
  // below (the port poll and the stdout hint can both fire; only the first should act).
  let viewOpen = false;

  function killDevProcess(): void {
    if (devProcess === null) return;
    devProcess.kill();
    devProcess = null;
  }

  function emitStatus(
    message: string,
    stage: 'installing' | 'starting' | 'ready' | 'error' = 'starting',
  ): void {
    if (window !== null && !window.isDestroyed()) {
      emitToWindow(window, 'preview:statusUpdate', { message, stage });
    }
  }

  function isLocalhostUrl(rawUrl: string): boolean {
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      return false;
    }
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1')
    );
  }

  async function scanForDevServer(): Promise<DetectedServer | null> {
    const result = await scanPorts();
    if (result !== null && window !== null && !window.isDestroyed()) {
      emitToWindow(window, 'preview:serverDetected', result);
    }
    return result;
  }

  function startScanning(): void {
    if (scanTimer !== null || scanStartTimer !== null) return;
    // Delay scan start so app startup (DB, handlers, terminal) completes first before network
    // probing begins.
    scanStartTimer = setTimeout(() => {
      scanStartTimer = null;
      if (scanTimer !== null) return; // already started
      // Fired once immediately, then on the interval — otherwise the first detection waits a
      // full SCAN_INTERVAL_MS even when a dev server was already running before Preview was opened.
      void scanForDevServer();
      scanTimer = setInterval(() => {
        void scanForDevServer();
      }, SCAN_INTERVAL_MS);
    }, SCAN_START_DELAY_MS);
  }

  function stopScanning(): void {
    if (scanStartTimer !== null) {
      clearTimeout(scanStartTimer);
      scanStartTimer = null;
    }
    if (scanTimer === null) return;
    clearInterval(scanTimer);
    scanTimer = null;
  }

  function createView(bounds: Rectangle): void {
    if (window === null) return;
    // If a view already exists, destroy it first — createView must never leak the old one.
    if (view !== null) {
      window.contentView.removeChildView(view);
      view.webContents.close();
      view = null;
      viewOpen = false;
    }
    const created = new WebContentsView({
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        session: session.fromPartition('persist:fixora-preview'),
      },
    });

    created.webContents.setWindowOpenHandler(({ url }) => {
      console.error('[preview] blocked window.open to a non-preview URL', {
        allowed: isLocalhostUrl(url),
      });
      return { action: 'deny' };
    });
    created.webContents.on('will-navigate', (event, url) => {
      if (!isLocalhostUrl(url)) {
        event.preventDefault();
        console.error('[preview] blocked navigation to a non-localhost URL');
      }
    });
    created.webContents.on('page-title-updated', (_event, title) => {
      if (!window.isDestroyed()) {
        emitToWindow(window, 'preview:titleChanged', { title });
      }
    });
    created.webContents.on('did-start-loading', () => {
      if (!window.isDestroyed()) {
        emitToWindow(window, 'preview:loadingChanged', { loading: true });
      }
    });
    created.webContents.on('did-stop-loading', () => {
      if (!window.isDestroyed()) {
        emitToWindow(window, 'preview:loadingChanged', { loading: false });
      }
    });
    const emitNavigationChanged = (): void => {
      if (!window.isDestroyed()) {
        emitToWindow(window, 'preview:navigationChanged', {
          canGoBack: created.webContents.navigationHistory.canGoBack(),
          canGoForward: created.webContents.navigationHistory.canGoForward(),
        });
      }
    };
    created.webContents.on('did-navigate', emitNavigationChanged);
    created.webContents.on('did-navigate-in-page', emitNavigationChanged);

    created.setBounds(bounds);
    window.contentView.addChildView(created);
    view = created;
    viewOpen = true;
  }

  function destroyView(): void {
    killDevProcess();
    if (view === null) {
      viewOpen = false;
      return;
    }
    try {
      if (window !== null && !window.isDestroyed()) {
        window.contentView.removeChildView(view);
      }
      // Guard: webContents may already be destroyed
      if (!view.webContents.isDestroyed()) {
        view.webContents.close();
      }
    } catch (error) {
      console.error('[preview] destroyView error (ignored):', error);
    } finally {
      view = null;
      viewOpen = false;
      currentUrl = null;
      currentPort = null;
    }
  }

  function resizeView(bounds: Rectangle): void {
    view?.setBounds(bounds);
  }

  function hideView(): void {
    view?.setVisible(false);
  }

  function showView(): void {
    view?.setVisible(true);
  }

  function loadUrl(url: string): void {
    if (!isLocalhostUrl(url)) {
      console.error('[preview] refused to load a non-localhost URL');
      return;
    }
    currentUrl = url;
    try {
      currentPort = Number.parseInt(new URL(url).port, 10) || null;
    } catch {
      currentPort = null;
    }
    void view?.webContents.loadURL(url);
  }

  function refresh(): void {
    view?.webContents.reload();
  }

  function goBack(): void {
    view?.webContents.navigationHistory.goBack();
  }

  function goForward(): void {
    view?.webContents.navigationHistory.goForward();
  }

  function getState(): { url: string | null; isOpen: boolean; port: number | null } {
    return { url: currentUrl, isOpen: view !== null, port: currentPort };
  }

  function notifyFileSaved(): void {
    if (view === null || !viewOpen) return;
    // Delayed, not immediate — gives the dev server's HMR a chance to process the change itself
    // first. Vite/webpack HMR updates in place without this; this reload is the fallback for
    // projects where HMR isn't picking the change up.
    setTimeout(() => {
      view?.webContents.reload();
    }, 1000);
  }

  async function checkDevScript(): Promise<{ hasScript: boolean; command: string | null }> {
    const open = workspace.getCurrent();
    if (open === null) return { hasScript: false, command: null };
    let pkg: unknown;
    try {
      pkg = JSON.parse(await readFile(join(open.rootPath, 'package.json'), 'utf8'));
    } catch {
      // Missing or unparsable package.json — no dev script to offer, not an error to surface.
      return { hasScript: false, command: null };
    }
    const scripts =
      typeof pkg === 'object' && pkg !== null
        ? (pkg as { scripts?: unknown }).scripts
        : undefined;
    const hasScript =
      typeof scripts === 'object' &&
      scripts !== null &&
      typeof (scripts as Record<string, unknown>)['dev'] === 'string';
    if (!hasScript) return { hasScript: false, command: null };
    return { hasScript: true, command: devCommandFor(detectPackageManager(open.rootPath)) };
  }

  async function launchDevServer(): Promise<{ ok: boolean; error?: string }> {
    const detected = await checkDevScript();
    if (!detected.hasScript) {
      return { ok: false, error: 'No "dev" script found in package.json' };
    }
    return { ok: true };
  }

  async function launchAndPreview(devCommand: string): Promise<{ ok: boolean; error?: string }> {
    if (launching) return { ok: true }; // Already in progress
    launching = true;
    try {
      // Already running — open it directly, no process spawned. Retried a few times with a gap —
      // a server can be up but not answer the very first probe.
      let already: DetectedServer | null = null;
      for (let i = 0; i < 3; i++) {
        already = await scanPorts();
        if (already !== null) break;
        if (i < 2) {
          await new Promise((resolve) => {
            setTimeout(resolve, 500);
          });
        }
      }
      if (already !== null) {
        if (window !== null && !window.isDestroyed()) {
          emitToWindow(window, 'preview:serverDetected', already);
        }
        createView(DEFAULT_BOUNDS);
        loadUrl(already.url);
        emitStatus('Preview ready', 'ready');
        return { ok: true };
      }

      const open = workspace.getCurrent();
      if (open === null) return { ok: false, error: 'No project is open.' };

      const trimmed = devCommand.trim();
      const parts = trimmed.split(/\s+/);
      const command = parts[0];
      if (command === undefined || command === '') {
        return { ok: false, error: 'No dev command to run.' };
      }
      const args = parts.slice(1);

      const nodeModulesPath = join(open.rootPath, 'node_modules');
      const needsInstall = !existsSync(nodeModulesPath);
      if (needsInstall) {
        const hasPnpmLock = existsSync(join(open.rootPath, 'pnpm-lock.yaml'));
        const hasYarnLock = existsSync(join(open.rootPath, 'yarn.lock'));
        const installCmd = hasPnpmLock ? 'pnpm' : hasYarnLock ? 'yarn' : 'npm';
        const installArgs = ['install'];

        emitStatus('Installing dependencies...', 'installing');

        const installError = await new Promise<Error | null>((resolve) => {
          const installProc = spawn(installCmd, installArgs, {
            cwd: open.rootPath,
            shell: true,
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsHide: true,
            env: { ...process.env },
          });
          const timer = setTimeout(() => {
            installProc.kill();
            resolve(new Error('Install timed out after 120 seconds'));
          }, INSTALL_TIMEOUT_MS);
          installProc.stdout.on('data', (data: Buffer) => {
            const text = data.toString().trim().slice(0, 80);
            if (text !== '') emitStatus(`Installing: ${text}`, 'installing');
          });
          installProc.on('exit', (code) => {
            clearTimeout(timer);
            if (code === 0) resolve(null);
            else resolve(new Error(`Install failed with code ${String(code)}`));
          });
          installProc.on('error', (error) => {
            clearTimeout(timer);
            resolve(error);
          });
        });
        if (installError !== null) {
          emitStatus(`Install failed: ${installError.message}`, 'error');
          return { ok: false, error: installError.message };
        }
      }

      emitStatus('Starting dev server...', 'starting');

      killDevProcess(); // a stale process from a previous attempt, if any
      const proc = spawn(command, args, {
        cwd: open.rootPath,
        shell: true, // Let OS shell resolve PATH (pnpm/npm/yarn)
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        env: { ...process.env }, // Inherit full environment including PATH
      });
      proc.stderr.on('data', (data: Buffer) => {
        console.error('[preview] dev server stderr:', data.toString().slice(0, 200));
      });
      // Also scan stdout for a port announcement (Vite/Next print "localhost:PORT") — opens the
      // view straight away rather than waiting for the next poll tick, with a fallback pattern for
      // tools that print just ":PORT" with no host.
      proc.stdout.on('data', (data: Buffer) => {
        const text = data.toString();
        const portMatch =
          /(?:localhost|127\.0\.0\.1|0\.0\.0\.0):(\d+)/i.exec(text) ?? /➜.*?:(\d+)/.exec(text);
        const portStr = portMatch?.[1];
        if (portStr === undefined) return;
        const port = Number.parseInt(portStr, 10);
        if (!(port > 0 && port < 65536)) return;
        const url = `http://localhost:${String(port)}`;
        console.error('[preview] port from stdout:', port);
        // Opened after a short delay, not immediately — the port is often bound before the server
        // is actually ready to answer requests. Only if the poll loop hasn't already opened it.
        void (async () => {
          await new Promise((resolve) => {
            setTimeout(resolve, 1000);
          });
          if (viewOpen) return;
          if (window !== null && !window.isDestroyed()) {
            emitToWindow(window, 'preview:serverDetected', {
              port,
              url,
              framework: FRAMEWORK_HINTS[port] ?? 'Dev Server',
            });
          }
          createView(DEFAULT_BOUNDS);
          loadUrl(url);
          emitStatus('Preview ready', 'ready');
        })();
      });
      devProcess = proc;
      devProcess.on('exit', () => {
        devProcess = null;
      });

      const guessedPort = guessPortFromCommand(devCommand);
      const deadline = Date.now() + LAUNCH_TIMEOUT_MS;
      while (Date.now() < deadline) {
        // Try the framework's default port directly first — cheaper than a full scan, and it's
        // usually right.
        if (guessedPort !== null && (await probePort(guessedPort))) {
          const found: DetectedServer = {
            port: guessedPort,
            url: `http://localhost:${String(guessedPort)}`,
            framework: FRAMEWORK_HINTS[guessedPort] ?? 'Dev Server',
          };
          if (window !== null && !window.isDestroyed()) {
            emitToWindow(window, 'preview:serverDetected', found);
          }
          createView(DEFAULT_BOUNDS);
          loadUrl(found.url);
          emitStatus('Preview ready', 'ready');
          return { ok: true };
        }
        const found = await scanPorts();
        if (found !== null) {
          if (window !== null && !window.isDestroyed()) {
            emitToWindow(window, 'preview:serverDetected', found);
          }
          createView(DEFAULT_BOUNDS);
          loadUrl(found.url);
          emitStatus('Preview ready', 'ready');
          return { ok: true };
        }
        await new Promise((resolve) => {
          setTimeout(resolve, LAUNCH_POLL_INTERVAL_MS);
        });
      }
      killDevProcess();
      emitStatus('Dev server did not start within 30 seconds.', 'error');
      return { ok: false, error: 'Dev server did not start within 30 seconds.' };
    } finally {
      launching = false;
    }
  }

  function dispose(): void {
    killDevProcess();
    stopScanning();
    destroyView();
  }

  function stopDevProcess(): void {
    killDevProcess();
  }
  // Belt to `index.ts`'s own `will-quit` cleanup: self-registered so a spawned dev server can
  // never outlive the app even if a future call site forgets to wire this in explicitly — the
  // same reasoning terminal.handlers.ts's own `app.on('will-quit')` documents for PTY sessions.
  app.once('will-quit', dispose);

  return {
    scanForDevServer,
    startScanning,
    stopScanning,
    createView,
    destroyView,
    resizeView,
    hideView,
    showView,
    loadUrl,
    refresh,
    goBack,
    goForward,
    getState,
    notifyFileSaved,
    checkDevScript,
    launchDevServer,
    launchAndPreview,
    dispose,
    stopDevProcess,
  };
}
