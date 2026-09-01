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

const COMMON_PORTS = [3000, 5173, 8080, 4200, 8000, 3001, 4000, 8888];
const FRAMEWORK_HINTS: Record<number, string> = {
  5173: 'Vite',
  3000: 'Next.js / React',
  4200: 'Angular',
  8080: 'Generic',
  8000: 'Python',
};

const SCAN_INTERVAL_MS = 3000;
const PROBE_TIMEOUT_MS = 500;
/** Delay before the first scan — well after terminal handlers are registered, so startup (DB,
 *  handler registration, terminal availability) finishes before network probing begins. */
const SCAN_START_DELAY_MS = 5000;
/** How long `launchAndPreview` waits for the spawned dev server to start listening before giving up. */
const LAUNCH_TIMEOUT_MS = 30_000;
const LAUNCH_POLL_INTERVAL_MS = 500;
const DEFAULT_BOUNDS: Rectangle = { x: 0, y: 0, width: 800, height: 600 };

export type DetectedServer = { port: number; url: string; framework: string };

export interface PreviewService {
  scanForDevServer(): Promise<DetectedServer | null>;
  startScanning(): void;
  stopScanning(): void;
  createView(bounds: Rectangle): void;
  destroyView(): void;
  resizeView(bounds: Rectangle): void;
  loadUrl(url: string): void;
  refresh(): void;
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
 *  unhandled promise. */
function probePort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const req = httpGet(
      { host: '127.0.0.1', port, path: '/', timeout: PROBE_TIMEOUT_MS },
      (res) => {
        res.resume(); // drain, so the socket can close instead of leaking
        resolve(true);
      },
    );
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
    req.on('error', () => {
      resolve(false);
    });
  });
}

/** First `COMMON_PORTS` entry that answers, in the array's own priority order — not necessarily
 *  the fastest to respond, so two dev servers running at once resolve deterministically. Probed
 *  in parallel (each still bounded by `PROBE_TIMEOUT_MS`), so a full scan costs one timeout's
 *  worth of wall-clock time, not one per port. */
async function scanPorts(): Promise<DetectedServer | null> {
  const results = await Promise.all(
    COMMON_PORTS.map((port) => probePort(port).then((ok) => (ok ? port : null))),
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

  function killDevProcess(): void {
    if (devProcess === null) return;
    devProcess.kill();
    devProcess = null;
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
    if (window === null || view !== null) return;
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

    created.setBounds(bounds);
    window.contentView.addChildView(created);
    view = created;
  }

  function destroyView(): void {
    killDevProcess();
    if (view === null) return;
    window?.contentView.removeChildView(view);
    view.webContents.close();
    view = null;
    currentUrl = null;
    currentPort = null;
  }

  function resizeView(bounds: Rectangle): void {
    view?.setBounds(bounds);
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

  function getState(): { url: string | null; isOpen: boolean; port: number | null } {
    return { url: currentUrl, isOpen: view !== null, port: currentPort };
  }

  function notifyFileSaved(): void {
    if (view !== null) refresh();
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
    // Already running — open it directly, no process spawned.
    const already = await scanPorts();
    if (already !== null) {
      if (window !== null && !window.isDestroyed()) {
        emitToWindow(window, 'preview:serverDetected', already);
      }
      createView(DEFAULT_BOUNDS);
      loadUrl(already.url);
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
    const isWindows = process.platform === 'win32';
    // Windows: run through cmd.exe explicitly rather than shell:true's own quoting, so a package
    // manager on PATH without a registered file association (pnpm/npm's .cmd shims) still resolves.
    const spawnCommand = isWindows ? 'cmd' : command;
    const spawnArgs = isWindows ? ['/c', trimmed] : args;

    killDevProcess(); // a stale process from a previous attempt, if any
    const proc = spawn(spawnCommand, spawnArgs, {
      cwd: open.rootPath,
      shell: !isWindows, // cmd.exe already handles quoting/resolution on Windows
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    proc.stderr.on('data', (data: Buffer) => {
      console.error('[preview] dev server stderr:', data.toString().slice(0, 200));
    });
    // Also scan stdout for port hints (Vite/Next print "localhost:PORT") — logged only; the port
    // scanner above is still the source of truth for when to actually open the view.
    proc.stdout.on('data', (data: Buffer) => {
      const portMatch = /localhost:(\d+)/i.exec(data.toString());
      if (portMatch !== null) {
        const port = Number.parseInt(portMatch[1] ?? '0', 10);
        if (port > 0) console.error('[preview] detected port from stdout:', port);
      }
    });
    devProcess = proc;
    devProcess.on('exit', () => {
      devProcess = null;
    });

    const deadline = Date.now() + LAUNCH_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const found = await scanPorts();
      if (found !== null) {
        if (window !== null && !window.isDestroyed()) {
          emitToWindow(window, 'preview:serverDetected', found);
        }
        createView(DEFAULT_BOUNDS);
        loadUrl(found.url);
        return { ok: true };
      }
      await new Promise((resolve) => {
        setTimeout(resolve, LAUNCH_POLL_INTERVAL_MS);
      });
    }
    killDevProcess();
    return { ok: false, error: 'Dev server did not start within 30 seconds.' };
  }

  function dispose(): void {
    killDevProcess();
    stopScanning();
    destroyView();
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
    loadUrl,
    refresh,
    getState,
    notifyFileSaved,
    checkDevScript,
    launchDevServer,
    launchAndPreview,
    dispose,
  };
}
