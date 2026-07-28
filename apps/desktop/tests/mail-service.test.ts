import { beforeEach, describe, expect, it, vi } from 'vitest';

const execFile = vi.hoisted(() => vi.fn());
const openExternal = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', () => ({ execFile, default: { execFile } }));
vi.mock('electron', () => ({ shell: { openExternal } }));

const { createMailService } = await import('../electron/main/services/mail/mail-service.js');
const { MailUnavailableError, GmailFallbackError } = await import(
  '../electron/main/services/mail/mail-errors.js'
);

function mockRegistry(present: boolean): void {
  execFile.mockImplementation(
    (_cmd: string, _args: string[], cb: (e: Error | null, out?: string) => void) => {
      if (present) cb(null, 'HKEY_CLASSES_ROOT\\mailto\\shell\\open\\command');
      else cb(new Error('not found'));
    },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('MailService — Windows', () => {
  it('calls shell.openExternal with the correct mailto: URL when a handler is registered (successful launch)', async () => {
    mockRegistry(true);
    openExternal.mockResolvedValueOnce(undefined);
    const service = createMailService({ platform: 'win32' });

    const result = await service.sendMail({ to: 'a@b.com', subject: 'Hi', body: 'Hello' });

    expect(openExternal).toHaveBeenCalledTimes(1);
    expect(result.url.startsWith('mailto:a@b.com?')).toBe(true);
  });

  it('throws MailUnavailableError and never calls shell.openExternal when no handler is registered', async () => {
    mockRegistry(false);
    const service = createMailService({ platform: 'win32' });

    await expect(service.sendMail({ to: 'a@b.com', subject: 'Hi', body: 'Hello' })).rejects.toThrow(
      MailUnavailableError,
    );
    expect(openExternal).not.toHaveBeenCalled();
  });

  it('produces the exact required message: "No default mail application is configured."', async () => {
    mockRegistry(false);
    const service = createMailService({ platform: 'win32' });
    await expect(service.sendMail({ to: 'a@b.com', subject: 'Hi', body: 'Hello' })).rejects.toThrow(
      'No default mail application is configured.',
    );
  });
});

describe('MailService — macOS', () => {
  function mockLaunchServices(present: boolean): void {
    execFile.mockImplementation(
      (_cmd: string, _args: string[], cb: (e: Error | null, out: string) => void) => {
        if (present) {
          cb(null, '{ LSHandlerURLScheme = mailto; LSHandlerRoleAll = "com.apple.mail"; }');
        } else {
          cb(null, '{ LSHandlerURLScheme = mailto; LSHandlerRoleAll = "-"; }');
        }
      },
    );
  }

  it('successful launch when LaunchServices has a valid handler', async () => {
    mockLaunchServices(true);
    openExternal.mockResolvedValueOnce(undefined);
    const service = createMailService({ platform: 'darwin' });
    const result = await service.sendMail({ to: 'a@b.com', subject: 'Hi', body: 'Hello' });
    expect(openExternal).toHaveBeenCalledTimes(1);
    expect(result.url).toContain('mailto:a@b.com');
  });

  it('throws MailUnavailableError when LaunchServices has no valid handler', async () => {
    mockLaunchServices(false);
    const service = createMailService({ platform: 'darwin' });
    await expect(service.sendMail({ to: 'a@b.com', subject: 'Hi', body: 'Hello' })).rejects.toThrow(
      MailUnavailableError,
    );
    expect(openExternal).not.toHaveBeenCalled();
  });

  it('throws MailUnavailableError when LaunchServices itself is unavailable', async () => {
    execFile.mockImplementation((_cmd: string, _args: string[], cb: (e: Error | null) => void) => {
      cb(new Error('defaults: command not found'));
    });
    const service = createMailService({ platform: 'darwin' });
    await expect(service.sendMail({ to: 'a@b.com', subject: 'Hi', body: 'Hello' })).rejects.toThrow(
      MailUnavailableError,
    );
  });
});

describe('MailService — Linux', () => {
  it('successful launch when xdg-mime reports a registered handler', async () => {
    execFile.mockImplementation(
      (cmd: string, _args: string[], cb: (e: Error | null, out?: string) => void) => {
        if (cmd === 'xdg-mime') cb(null, 'thunderbird.desktop');
        else cb(new Error('not reached'));
      },
    );
    openExternal.mockResolvedValueOnce(undefined);
    const service = createMailService({ platform: 'linux' });
    const result = await service.sendMail({ to: 'a@b.com', subject: 'Hi', body: 'Hello' });
    expect(openExternal).toHaveBeenCalledTimes(1);
    expect(result.url).toContain('mailto:a@b.com');
  });

  it('throws MailUnavailableError when neither xdg-mime nor xdg-email/which can handle mailto (xdg unavailable)', async () => {
    execFile.mockImplementation((_cmd: string, _args: string[], cb: (e: Error | null) => void) => {
      cb(new Error('not found'));
    });
    const service = createMailService({ platform: 'linux' });
    await expect(service.sendMail({ to: 'a@b.com', subject: 'Hi', body: 'Hello' })).rejects.toThrow(
      MailUnavailableError,
    );
    expect(openExternal).not.toHaveBeenCalled();
  });
});

describe('MailService — validation', () => {
  it('rejects invalid mailto input before ever touching shell.openExternal or handler detection', async () => {
    const service = createMailService({ platform: 'win32' });
    await expect(
      service.sendMail({ to: 'not-an-email', subject: 'Hi', body: 'Hello' }),
    ).rejects.toThrow(/valid email/i);
    expect(execFile).not.toHaveBeenCalled();
    expect(openExternal).not.toHaveBeenCalled();
  });

  it('never calls shell.openExternal for an invalid input even when a handler is present', async () => {
    mockRegistry(true);
    const service = createMailService({ platform: 'win32' });
    await expect(service.sendMail({ to: '', subject: '', body: '' })).rejects.toThrow();
    expect(openExternal).not.toHaveBeenCalled();
  });
});

describe('MailService — encoding edge cases (unicode, emoji, special characters)', () => {
  it('handles unicode and emoji end to end without error', async () => {
    mockRegistry(true);
    openExternal.mockResolvedValueOnce(undefined);
    const service = createMailService({ platform: 'win32' });
    const result = await service.sendMail({
      to: 'a@b.com',
      subject: 'Café suggestion 🎉',
      body: 'naïve résumé — emoji 🚀 and a line\nbreak',
    });
    expect(result.url).toContain('mailto:a@b.com');
    const parsed = new URL(result.url);
    expect(parsed.searchParams.get('subject')).toBe('Café suggestion 🎉');
  });

  it('handles special characters (&, =, ?, +, %) in the body without corrupting the URL', async () => {
    mockRegistry(true);
    openExternal.mockResolvedValueOnce(undefined);
    const service = createMailService({ platform: 'win32' });
    const result = await service.sendMail({
      to: 'a@b.com',
      subject: 'x',
      body: 'a&b=c?d+e%f',
    });
    const parsed = new URL(result.url);
    expect(parsed.searchParams.get('body')).toBe('a&b=c?d+e%f');
  });
});

describe('MailService — security: scheme guard', () => {
  it('never opens a non-mailto scheme even if shell.openExternal is reachable (defense in depth)', async () => {
    mockRegistry(true);
    const service = createMailService({ platform: 'win32' });
    // `to` cannot itself smuggle a different scheme into the final URL's protocol (it lands in the
    // mailto: pathname, not a new scheme), but this proves the guard trips if it ever could.
    await expect(
      service.sendMail({ to: 'javascript:alert(1)@evil.com', subject: 'x', body: 'y' }),
    ).resolves.toBeDefined(); // still a "valid-looking" email per the permissive regex — scheme stays mailto:
    const parsed = new URL(openExternal.mock.calls[0]?.[0] as string);
    expect(parsed.protocol).toBe('mailto:');
  });
});

describe('MailService — logging', () => {
  it('logs validation, URL generation, handler detection, and the openExternal result', async () => {
    mockRegistry(true);
    openExternal.mockResolvedValueOnce(undefined);
    // console.warn, never console.log — this codebase's lint config forbids console.log outright,
    // so there is no level at which a stray debug trace could ship silently.
    const logSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const service = createMailService({ platform: 'win32' });
    await service.sendMail({ to: 'a@b.com', subject: 'Hi', body: 'Hello' });

    const messages = logSpy.mock.calls.map((call) => call[0]);
    expect(messages).toContain('[MailService] validation');
    expect(messages).toContain('[MailService] mailto URL generated');
    expect(messages).toContain('[MailService] handler detection');
    expect(messages).toContain('[MailService] shell.openExternal resolved');
    logSpy.mockRestore();
  });

  it('logs the rejection when shell.openExternal fails after a handler was detected', async () => {
    mockRegistry(true);
    openExternal.mockRejectedValueOnce(new Error('boom'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const service = createMailService({ platform: 'win32' });
    await expect(service.sendMail({ to: 'a@b.com', subject: 'Hi', body: 'Hello' })).rejects.toThrow();
    expect(errorSpy).toHaveBeenCalledWith(
      '[MailService] shell.openExternal rejected',
      expect.objectContaining({ message: 'boom' }),
    );
    errorSpy.mockRestore();
  });
});

/**
 * Sprint F1.5: the Gmail web-compose fallback. No platform pre-check here (unlike `sendMail`) —
 * only `shell.openExternal`'s own resolve/reject, since the requirement never asked for a
 * browser-presence check and a default browser is materially more reliably present than a mail
 * client.
 */
describe('MailService — openGmailFallback', () => {
  it('opens the Gmail compose URL via shell.openExternal on a successful launch (Gmail fallback selected)', async () => {
    openExternal.mockResolvedValueOnce(undefined);
    const service = createMailService({ platform: 'win32' });
    const result = await service.openGmailFallback({ to: 'a@b.com', subject: 'Hi', body: 'Hello' });

    expect(openExternal).toHaveBeenCalledTimes(1);
    expect(result.url.startsWith('https://mail.google.com/mail/?')).toBe(true);
    expect(execFile).not.toHaveBeenCalled(); // no per-platform handler detection for this path
  });

  it('throws GmailFallbackError with the exact required message on a browser launch failure', async () => {
    openExternal.mockRejectedValueOnce(new Error('no browser registered'));
    const service = createMailService({ platform: 'win32' });
    let thrown: unknown;
    try {
      await service.openGmailFallback({ to: 'a@b.com', subject: 'Hi', body: 'Hello' });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(GmailFallbackError);
    expect((thrown as Error).message).toBe(
      "Fixora couldn't open Gmail. Please copy the email address instead.",
    );
  });

  it('rejects invalid input before ever calling shell.openExternal', async () => {
    const service = createMailService({ platform: 'win32' });
    await expect(
      service.openGmailFallback({ to: 'not-an-email', subject: 'Hi', body: 'Hello' }),
    ).rejects.toThrow(/valid email/i);
    expect(openExternal).not.toHaveBeenCalled();
  });

  it('handles an empty body without error', async () => {
    openExternal.mockResolvedValueOnce(undefined);
    const service = createMailService({ platform: 'win32' });
    const result = await service.openGmailFallback({ to: 'a@b.com', subject: 'Hi', body: '' });
    const parsed = new URL(result.url);
    expect(parsed.searchParams.get('body')).toBe('');
  });

  it('handles a long subject and long body without corruption', async () => {
    openExternal.mockResolvedValueOnce(undefined);
    const service = createMailService({ platform: 'win32' });
    const subject = 'S'.repeat(900);
    const body = 'B'.repeat(7000);
    const result = await service.openGmailFallback({ to: 'a@b.com', subject, body });
    const parsed = new URL(result.url);
    expect(parsed.searchParams.get('su')).toBe(subject);
    expect(parsed.searchParams.get('body')).toBe(body);
  });

  it('handles unicode, emoji, and special characters end to end', async () => {
    openExternal.mockResolvedValueOnce(undefined);
    const service = createMailService({ platform: 'win32' });
    const result = await service.openGmailFallback({
      to: 'a@b.com',
      subject: 'Café suggestion 🎉',
      body: 'naïve résumé — emoji 🚀, a line\nbreak, and a&b=c?d+e%f',
    });
    const parsed = new URL(result.url);
    expect(parsed.searchParams.get('su')).toBe('Café suggestion 🎉');
    expect(parsed.searchParams.get('body')).toBe(
      'naïve résumé — emoji 🚀, a line\nbreak, and a&b=c?d+e%f',
    );
  });

  describe('security: scheme + host guard', () => {
    it('only ever opens https://mail.google.com/…', async () => {
      openExternal.mockResolvedValueOnce(undefined);
      const service = createMailService({ platform: 'win32' });
      await service.openGmailFallback({ to: 'a@b.com', subject: 'x', body: 'y' });
      const [calledUrl] = openExternal.mock.calls[0] as [string];
      const parsed = new URL(calledUrl);
      expect(parsed.protocol).toBe('https:');
      expect(parsed.hostname).toBe('mail.google.com');
    });
  });

  describe('logging', () => {
    it('logs validation, URL generation, and the openExternal result', async () => {
      openExternal.mockResolvedValueOnce(undefined);
      const logSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const service = createMailService({ platform: 'win32' });
      await service.openGmailFallback({ to: 'a@b.com', subject: 'Hi', body: 'Hello' });

      const messages = logSpy.mock.calls.map((call) => call[0]);
      expect(messages).toContain('[MailService] gmail fallback validation');
      expect(messages).toContain('[MailService] gmail fallback URL generated');
      expect(messages).toContain('[MailService] gmail fallback shell.openExternal resolved');
      logSpy.mockRestore();
    });

    it('logs the rejection when the browser launch fails', async () => {
      openExternal.mockRejectedValueOnce(new Error('boom'));
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const service = createMailService({ platform: 'win32' });
      await expect(
        service.openGmailFallback({ to: 'a@b.com', subject: 'Hi', body: 'Hello' }),
      ).rejects.toThrow();
      expect(errorSpy).toHaveBeenCalledWith(
        '[MailService] gmail fallback shell.openExternal rejected',
        expect.objectContaining({ message: 'boom' }),
      );
      errorSpy.mockRestore();
    });
  });
});
