import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { get as httpGet } from 'node:http';
import { join } from 'node:path';

import { session, WebContentsView, type BrowserWindow, type Rectangle } from 'electron';

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
  };
}
