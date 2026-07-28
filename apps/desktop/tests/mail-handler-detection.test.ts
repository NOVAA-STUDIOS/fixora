import { beforeEach, describe, expect, it, vi } from 'vitest';

const execFile = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', () => ({ execFile, default: { execFile } }));

const {
  hasWindowsMailtoHandler,
  hasMacMailtoHandler,
  hasLinuxMailtoHandler,
  hasMailtoHandler,
} = await import('../electron/main/services/mail/mail-handler-detection.js');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('hasWindowsMailtoHandler', () => {
  it('returns true when the registry key resolves with content', async () => {
    execFile.mockImplementation(
      (_cmd: string, _args: string[], cb: (e: Error | null, out: string) => void) => {
        cb(null, 'HKEY_CLASSES_ROOT\\mailto\\shell\\open\\command\n    (Default)  REG_SZ  "Outlook.exe" %1');
      },
    );
    expect(await hasWindowsMailtoHandler()).toBe(true);
  });

  it('returns false when reg query exits non-zero (key absent — no handler installed)', async () => {
    execFile.mockImplementation((_cmd: string, _args: string[], cb: (e: Error | null) => void) => {
      cb(new Error('ERROR: The system was unable to find the specified registry key.'));
    });
    expect(await hasWindowsMailtoHandler()).toBe(false);
  });

  it('returns false when reg.exe itself is unavailable (registry tooling unavailable)', async () => {
    execFile.mockImplementation((_cmd: string, _args: string[], cb: (e: Error | null) => void) => {
      cb(new Error('ENOENT: reg not found'));
    });
    expect(await hasWindowsMailtoHandler()).toBe(false);
  });
});

describe('hasMacMailtoHandler', () => {
  it('returns true when a mailto entry has a real handler bundle id', async () => {
    execFile.mockImplementation(
      (_cmd: string, _args: string[], cb: (e: Error | null, out: string) => void) => {
        cb(
          null,
          `(
    {
        LSHandlerURLScheme = mailto;
        LSHandlerRoleAll = "com.apple.mail";
    }
)`,
        );
      },
    );
    expect(await hasMacMailtoHandler()).toBe(true);
  });

  it('returns true regardless of key order within the dict (RoleAll before URLScheme)', async () => {
    execFile.mockImplementation(
      (_cmd: string, _args: string[], cb: (e: Error | null, out: string) => void) => {
        cb(
          null,
          `(
    {
        LSHandlerRoleAll = "com.apple.mail";
        LSHandlerURLScheme = mailto;
    }
)`,
        );
      },
    );
    expect(await hasMacMailtoHandler()).toBe(true);
  });

  it('returns false when the mailto entry has "-" (no handler assigned)', async () => {
    execFile.mockImplementation(
      (_cmd: string, _args: string[], cb: (e: Error | null, out: string) => void) => {
        cb(
          null,
          `(
    {
        LSHandlerURLScheme = mailto;
        LSHandlerRoleAll = "-";
    }
)`,
        );
      },
    );
    expect(await hasMacMailtoHandler()).toBe(false);
  });

  it('returns false when there is no mailto entry at all', async () => {
    execFile.mockImplementation(
      (_cmd: string, _args: string[], cb: (e: Error | null, out: string) => void) => {
        cb(
          null,
          `(
    {
        LSHandlerContentType = "public.html";
        LSHandlerRoleViewer = "com.apple.safari";
    }
)`,
        );
      },
    );
    expect(await hasMacMailtoHandler()).toBe(false);
  });

  it('returns false when LaunchServices/`defaults` is unavailable (fails closed, never assumes success)', async () => {
    execFile.mockImplementation((_cmd: string, _args: string[], cb: (e: Error | null) => void) => {
      cb(new Error('defaults: command not found'));
    });
    expect(await hasMacMailtoHandler()).toBe(false);
  });
});

describe('hasLinuxMailtoHandler', () => {
  it('returns true when xdg-mime reports a registered .desktop handler', async () => {
    execFile.mockImplementation(
      (_cmd: string, _args: string[], cb: (e: Error | null, out: string) => void) => {
        cb(null, 'thunderbird.desktop\n');
      },
    );
    expect(await hasLinuxMailtoHandler()).toBe(true);
  });

  it('falls back to checking xdg-email on PATH when xdg-mime reports nothing registered', async () => {
    execFile.mockImplementation(
      (cmd: string, _args: string[], cb: (e: Error | null, out: string) => void) => {
        if (cmd === 'xdg-mime') cb(null, '');
        else cb(null, '/usr/bin/xdg-email\n');
      },
    );
    expect(await hasLinuxMailtoHandler()).toBe(true);
  });

  it('returns false when neither xdg-mime nor xdg-email/which resolve anything (xdg unavailable)', async () => {
    execFile.mockImplementation((_cmd: string, _args: string[], cb: (e: Error | null) => void) => {
      cb(new Error('not found'));
    });
    expect(await hasLinuxMailtoHandler()).toBe(false);
  });
});

describe('hasMailtoHandler (dispatch)', () => {
  it('dispatches to the Windows check on win32', async () => {
    execFile.mockImplementation(
      (_cmd: string, _args: string[], cb: (e: Error | null, out: string) => void) => {
        cb(null, 'some value');
      },
    );
    expect(await hasMailtoHandler('win32')).toBe(true);
  });

  it('does not block an unrecognised platform on a check it has no implementation for', async () => {
    expect(await hasMailtoHandler('freebsd')).toBe(true);
    expect(execFile).not.toHaveBeenCalled();
  });
});
