import { describe, expect, it, vi } from 'vitest';

const openExternalSpy = vi.fn();

// The renderer never gets `electron`, and neither does a unit test. We are asserting on the
// decision the guard makes, not on Electron's behaviour.
vi.mock('electron', () => ({
  shell: { openExternal: openExternalSpy },
}));

const { openExternal } = await import('../electron/main/security/navigation-guard.js');

/**
 * "An unchecked `openExternal` on user-influenced input is a remote code execution primitive
 * on Windows." (Security §2)
 *
 * The inputs below are not hypothetical. `file:` opens a local executable. Windows URI
 * handlers (`ms-msdt:`, `search-ms:`) have each been a live RCE chain. A repo we open can put
 * any of them into a link.
 */
describe('openExternal', () => {
  it('opens https', () => {
    openExternal('https://fixora.dev/docs');
    expect(openExternalSpy).toHaveBeenCalledWith('https://fixora.dev/docs');
  });

  it.each([
    'file:///C:/Windows/System32/cmd.exe',
    'ms-msdt:/id PCWDiagnostic',
    'search-ms:query=x&crumb=location:\\\\attacker\\share',
    'javascript:fetch("https://attacker.example")',
    'vbscript:msgbox',
    'http://plaintext.example',
  ])('refuses %s', (hostile) => {
    expect(() => {
      openExternal(hostile);
    }).toThrow();
  });

  it('refuses a URL that does not parse rather than guessing at it', () => {
    expect(() => {
      openExternal('not a url');
    }).toThrow(/does not parse/);
  });
});
