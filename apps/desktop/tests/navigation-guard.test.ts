import { join } from 'node:path';

import { describe, expect, it, vi, beforeEach } from 'vitest';

const openExternalSpy = vi.fn();

// The renderer never gets `electron`, and neither does a unit test. We are asserting on the
// decision the guard makes, not on Electron's behaviour.
vi.mock('electron', () => ({
  shell: { openExternal: openExternalSpy },
}));

const { openExternal, isAppUrl } = await import('../electron/main/security/navigation-guard.js');

/**
 * "An unchecked `openExternal` on user-influenced input is a remote code execution primitive
 * on Windows." (Security §2) — and the same section requires the wrapper allow specific
 * **hosts**, not just the https scheme.
 *
 * The hostile inputs below are not hypothetical. `file:` opens a local executable. Windows URI
 * handlers (`ms-msdt:`, `search-ms:`) have each been a live RCE chain. A repo we open (M2+) can
 * put any of them, or a phishing `https://` link, into content the renderer displays.
 */
describe('openExternal', () => {
  beforeEach(() => {
    openExternalSpy.mockClear();
  });

  it('opens https to a host we own', () => {
    void openExternal('https://fixora.dev/docs');
    expect(openExternalSpy).toHaveBeenCalledWith('https://fixora.dev/docs');
  });

  it('opens https to an allowed subdomain and to github', () => {
    void openExternal('https://docs.fixora.dev/');
    void openExternal('https://github.com/fixora/fixora-desktop/issues/new');
    expect(openExternalSpy).toHaveBeenCalledTimes(2);
  });

  // The problem details panel links a finding to its analyzer's documentation. Those hosts were
  // added to the allowlist deliberately, so they are pinned here — and a *lookalike* of one still
  // has to be refused (the suffix cases below cover the trick).
  it.each([
    'https://eslint.org/docs/latest/rules/no-eval',
    'https://docs.astral.sh/ruff/rules/',
    'https://mypy.readthedocs.io/en/stable/error_code_list.html',
    'https://pkg.go.dev/cmd/vet',
    'https://semgrep.dev/r/python.lang.security.audit',
  ])('opens the analyzer docs URL %s', (docs) => {
    void openExternal(docs);
    expect(openExternalSpy).toHaveBeenCalledWith(docs);
  });

  it.each([
    'file:///C:/Windows/System32/cmd.exe',
    'ms-msdt:/id PCWDiagnostic',
    'search-ms:query=x&crumb=location:\\\\attacker\\share',
    'javascript:fetch("https://attacker.example")',
    'vbscript:msgbox',
    'http://plaintext.example',
  ])('refuses the non-https / RCE scheme %s', async (hostile) => {
    // `openExternal` is async (it awaits `shell.openExternal` rather than firing it and
    // forgetting) — every guard throw inside it is therefore a rejected promise, not a
    // synchronous throw.
    await expect(openExternal(hostile)).rejects.toThrow();
  });

  it.each([
    'https://attacker.example/phish',
    'https://fixora.dev.attacker.com/', // suffix-of-a-suffix trick
    'https://notfixora.dev/',
    'https://github.com.attacker.com/',
    'https://eslint.org.attacker.com/', // a docs host lookalike is still hostile
    'https://noteslint.org/',
  ])('refuses https to a host not on the allowlist: %s', async (hostile) => {
    await expect(openExternal(hostile)).rejects.toThrow(/host allowlist|only our own hosts/i);
  });

  it('refuses a URL that does not parse rather than guessing at it', async () => {
    await expect(openExternal('not a url')).rejects.toThrow(/does not parse/);
  });
});

/**
 * The navigation containment boundary. Before this was fixed, `isAppUrl` returned `true` for
 * ANY `file:` URL — including local secrets and UNC paths that reach out to an attacker's SMB
 * host. This is the boundary M2 leans on the moment Monaco renders an untrusted repo, so it is
 * tested hard now, at the foundation.
 */
describe('isAppUrl — production (file:)', () => {
  const rendererRoot = join('C:', 'app', 'out', 'renderer');
  const prod = { environment: 'production', rendererRoot } as const;

  it('allows the app’s own renderer entry and its assets', () => {
    expect(isAppUrl(`file:///C:/app/out/renderer/index.html`, prod)).toBe(true);
    expect(isAppUrl(`file:///C:/app/out/renderer/assets/index-abc.js`, prod)).toBe(true);
  });

  it.each([
    'file:///C:/Users/victim/.ssh/id_rsa',
    'file:///C:/Windows/System32/drivers/etc/hosts',
    'file:///C:/app/out/renderer/../../../secret.txt', // .. escape
    'file://attacker-host/payload.html', // UNC → outbound SMB to attacker
    'https://attacker.example/',
    'http://localhost:5173/', // the dev origin is not the prod app
  ])('blocks navigation to %s', (hostile) => {
    expect(isAppUrl(hostile, prod)).toBe(false);
  });
});

describe('isAppUrl — development (http origin)', () => {
  const dev = { environment: 'development', appOrigin: 'http://localhost:5173' } as const;

  it('allows the dev server origin', () => {
    expect(isAppUrl('http://localhost:5173/index.html', dev)).toBe(true);
  });

  it('never allows a file: URL, even in dev', () => {
    // The old blanket `file:` trust applied in dev too. It does not anymore.
    expect(isAppUrl('file:///C:/Users/victim/.ssh/id_rsa', dev)).toBe(false);
  });

  it('blocks a different origin', () => {
    expect(isAppUrl('http://localhost:6006/', dev)).toBe(false);
    expect(isAppUrl('https://attacker.example/', dev)).toBe(false);
  });
});
