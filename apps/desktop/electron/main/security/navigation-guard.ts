import { isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { shell, type BrowserWindow, type Session } from 'electron';

import { assertCspIsSafe, buildCsp } from './csp.js';

/**
 * Everything in Security §2 that has to be *code* rather than a `webPreferences` flag.
 *
 * The window options say what the renderer *is*; this file says what it is allowed to *reach*.
 * Both halves are required: `sandbox: true` on a window that will happily navigate to an
 * attacker's origin has bought you very little.
 */

/**
 * `shell.openExternal` on user-influenced input is a remote-code-execution primitive on
 * Windows — `file://`, `ms-msdt:` and friends are not hypothetical. Security §2 requires it be
 * gated on **schemes and hosts**. So it is never called directly; it is called through here,
 * and here allows only https to a small set of hosts we actually own or link to. A compromised
 * renderer (M2+ renders untrusted repo content) therefore cannot use it to launch an arbitrary
 * page — a phishing site, or a `https://…` that a browser extension turns into something worse
 * — in the user's real browser.
 */
const ALLOWED_EXTERNAL_HOSTS = new Set([
  'fixora.dev',
  'github.com',
  // Documentation hosts for the analyzers we run. The problem details panel links a finding to the
  // rule's own docs, which is the honest answer to "what does this rule actually mean" — we do not
  // ship a per-rule knowledge base and will not invent one. These are added one host at a time,
  // deliberately: the URLs are built by us from a fixed template, never taken from tool output
  // wholesale, so a hostile rule id can change a *path* here but never the host.
  'eslint.org',
  'docs.astral.sh',
  'mypy.readthedocs.io',
  'pkg.go.dev',
  'semgrep.dev',
]);

function isAllowedExternalHost(host: string): boolean {
  return ALLOWED_EXTERNAL_HOSTS.has(host) || host.endsWith('.fixora.dev');
}

export function openExternal(rawUrl: string): void {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`Refusing to open a URL that does not parse: ${rawUrl}`);
  }

  if (url.protocol !== 'https:') {
    throw new Error(
      `Refusing to open ${url.protocol} externally. Only https: is permitted (Security §2). ` +
        'An unchecked openExternal is a code-execution primitive on Windows.',
    );
  }

  if (!isAllowedExternalHost(url.hostname)) {
    throw new Error(
      `Refusing to open https://${url.hostname} externally. Only our own hosts are allowed ` +
        '(Security §2 requires a host allowlist, not just a scheme one).',
    );
  }

  void shell.openExternal(url.toString());
}

export type GuardOptions =
  | {
      environment: 'development';
      /** The http(s) origin the dev server is served from. Everything else is hostile. */
      appOrigin: string;
    }
  | {
      environment: 'production';
      /**
       * Absolute path to the directory the renderer is loaded from. In production the app is
       * served over `file:`, whose origin is the useless string `"null"` — so we cannot gate
       * navigation on origin. We gate it on the **resolved path being inside this directory**,
       * the same path-boundary discipline Security §3 mandates for the filesystem.
       */
      rendererRoot: string;
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
  const csp =
    options.environment === 'development'
      ? buildCsp('development', options.appOrigin)
      : buildCsp('production');
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

/**
 * Is this URL a legitimate navigation *within the app itself*?
 *
 * The previous version returned `true` for **any** `file:` URL. That trusted
 * `file:///C:/Users/victim/.ssh/id_rsa`, arbitrary system files, and — worst — UNC paths like
 * `file://attacker-host/x`, which initiate an outbound SMB/NTLM connection to a host the
 * attacker chose. It was not yet reachable in M0 (nothing untrusted is rendered), but it is the
 * exact containment boundary M2 depends on the moment Monaco renders a hostile repo.
 */
export function isAppUrl(rawUrl: string, options: GuardOptions): boolean {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }

  if (options.environment === 'development') {
    // In dev the app is http(s). A `file:` navigation is never legitimate here.
    return url.protocol !== 'file:' && url.origin === options.appOrigin;
  }

  // Production: only `file:` URLs whose resolved path sits inside the renderer directory.
  if (url.protocol !== 'file:') return false;
  // A non-empty host means a UNC path (`file://host/…`). Never ours; never followed.
  if (url.host !== '') return false;

  let target: string;
  try {
    target = fileURLToPath(url);
  } catch {
    return false;
  }
  return isInside(options.rendererRoot, target);
}

/**
 * Path-boundary check: is `candidate` the root itself or strictly beneath it, after resolving
 * `..` and normalising separators? Mirrors the FS guard the blueprint mandates (Security §3);
 * a string `startsWith` is not a defence, because `/app-evil` "starts with" `/app`.
 */
function isInside(root: string, candidate: string): boolean {
  const rel = relative(resolve(root), resolve(candidate));
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/** Logs carry the origin, never the full URL — a URL can carry a token or a path (Security §9). */
function redactOrigin(rawUrl: string): string {
  try {
    return new URL(rawUrl).origin;
  } catch {
    return '<unparseable>';
  }
}
