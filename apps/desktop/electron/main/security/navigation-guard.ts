import { shell, type BrowserWindow, type Session } from 'electron';

import { assertCspIsSafe, buildCsp, type CspEnvironment } from './csp.js';

/**
 * Everything in Security §2 that has to be *code* rather than a `webPreferences` flag.
 *
 * The window options say what the renderer *is*; this file says what it is allowed to *reach*.
 * Both halves are required: `sandbox: true` on a window that will happily navigate to an
 * attacker's origin has bought you very little.
 */

/**
 * `shell.openExternal` on user-influenced input is a remote-code-execution primitive on
 * Windows — `file://`, `ms-msdt:` and friends are not hypothetical. So it is never called
 * directly; it is called through here, and here has an allowlist.
 */
const ALLOWED_EXTERNAL_PROTOCOLS = new Set(['https:']);

export function openExternal(rawUrl: string): void {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`Refusing to open a URL that does not parse: ${rawUrl}`);
  }

  if (!ALLOWED_EXTERNAL_PROTOCOLS.has(url.protocol)) {
    throw new Error(
      `Refusing to open ${url.protocol} externally. Only https: is permitted (Security §2). ` +
        'An unchecked openExternal is a code-execution primitive on Windows.',
    );
  }

  void shell.openExternal(url.toString());
}

export type GuardOptions = {
  environment: CspEnvironment;
  /** The origin the renderer is legitimately served from. Everything else is hostile. */
  appOrigin: string;
};

export function applyNavigationGuards(window: BrowserWindow, options: GuardOptions): void {
  const { webContents } = window;

  // Nothing opens a new window. Not a popup, not target="_blank", not window.open.
  webContents.setWindowOpenHandler(({ url }) => {
    // A link to our own docs is a legitimate thing for a user to click. It opens in their
    // real browser, through the allowlist — never in an Electron window we control.
    try {
      openExternal(url);
    } catch (error) {
      console.error('[security] blocked window.open', { reason: (error as Error).message });
    }
    return { action: 'deny' };
  });

  // The renderer never navigates away from itself. If it tries, something is already wrong.
  webContents.on('will-navigate', (event, url) => {
    if (!isAppUrl(url, options)) {
      event.preventDefault();
      console.error('[security] blocked navigation', { to: redactOrigin(url) });
    }
  });

  webContents.on('will-redirect', (event, url) => {
    if (!isAppUrl(url, options)) {
      event.preventDefault();
      console.error('[security] blocked redirect', { to: redactOrigin(url) });
    }
  });

  // <webview> is forbidden outright (Security §2). This is the belt to that braces.
  webContents.on('will-attach-webview', (event) => {
    event.preventDefault();
    console.error('[security] blocked <webview> attach');
  });

  // A renderer that renders other people's source code has no business asking for a camera.
  attachPermissionHandlers(webContents.session);
}

/** Deny every web permission. When one is genuinely needed, it gets added here, deliberately. */
export function attachPermissionHandlers(session: Session): void {
  session.setPermissionRequestHandler((_wc, permission, callback) => {
    console.error('[security] denied permission request', { permission });
    callback(false);
  });

  session.setPermissionCheckHandler(() => false);
}

/**
 * The CSP is delivered as a real response header, not only as a `<meta>` tag. A meta tag is a
 * hint that a compromised renderer can be loaded around; a header is applied by the network
 * layer before any of the document is parsed.
 */
export function attachCspHeader(session: Session, options: GuardOptions): void {
  const csp = buildCsp(options.environment, options.appOrigin);
  assertCspIsSafe(csp);

  session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [csp],
        'X-Content-Type-Options': ['nosniff'],
      },
    });
  });
}

function isAppUrl(rawUrl: string, options: GuardOptions): boolean {
  try {
    const url = new URL(rawUrl);
    if (url.protocol === 'file:') return true;
    return url.origin === options.appOrigin;
  } catch {
    return false;
  }
}

/** Logs carry the origin, never the full URL — a URL can carry a token or a path (Security §9). */
function redactOrigin(rawUrl: string): string {
  try {
    return new URL(rawUrl).origin;
  } catch {
    return '<unparseable>';
  }
}
