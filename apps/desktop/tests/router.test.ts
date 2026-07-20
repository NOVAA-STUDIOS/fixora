import type { AppInfo } from '@fixora/shared-types';
import { describe, expect, it, vi, beforeEach } from 'vitest';

// The router touches ipcMain and BrowserWindow.fromWebContents; a light stub keeps the import
// happy. fromWebContents returns null here — the window-control handlers are exercised in their
// own test with a real fake window; this suite is about routing, sender checks and validation.
vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  BrowserWindow: { fromWebContents: vi.fn(() => null) },
}));

// The registry is module-level singleton state, so each test imports a fresh module instance
// (after resetModules) to get an empty registry. This is what lets the tests be independent
// rather than order-coupled.
async function freshRouter() {
  vi.resetModules();
  return import('../electron/main/ipc/router.js');
}

const appInfo: AppInfo = {
  name: 'Fixora',
  version: '0.0.0',
  commit: 'abc1234',
  platform: 'win32',
  arch: 'x64',
  electronVersion: '0',
  isPackaged: false,
};

/**
 * A declared channel with no handler is a placeholder, and Standards §2 says placeholders do
 * not ship. The router refuses to start rather than letting a half-built channel reach a user's
 * machine and merely look like a transient failure. This asserts that refusal.
 */
describe('assertEveryChannelIsHandled', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws before startup if a declared channel has no handler', async () => {
    const { assertEveryChannelIsHandled } = await freshRouter();
    expect(() => {
      assertEveryChannelIsHandled();
    }).toThrow(/system:getAppInfo/);
  });

  it('names every unhandled channel, not just the first', async () => {
    const { assertEveryChannelIsHandled, registerHandler } = await freshRouter();
    registerHandler('system:getAppInfo', () => appInfo);
    // system is handled; the four window channels are not — all four must be named.
    expect(() => {
      assertEveryChannelIsHandled();
    }).toThrow(/window:minimize.*window:toggleMaximize.*window:close.*window:isMaximized/s);
  });

  it('passes once every channel has a handler', async () => {
    const { channels } = await import('@fixora/shared-types');
    const { assertEveryChannelIsHandled, registerHandler } = await freshRouter();
    // Register a stub for every declared channel — the assertion is about coverage, not shape.
    for (const channel of channels) {
      registerHandler(channel, () => undefined as never);
    }
    expect(() => {
      assertEveryChannelIsHandled();
    }).not.toThrow();
  });

  it('rejects a channel registered twice', async () => {
    const { registerHandler } = await freshRouter();
    registerHandler('system:getAppInfo', () => appInfo);
    expect(() => {
      registerHandler('system:getAppInfo', () => appInfo);
    }).toThrow(/twice/);
  });
});

type IpcListener = (
  event: unknown,
  raw: unknown,
) => Promise<{ ok: boolean; error?: { code: string } }>;

/** Mount a fresh router with a working handler and return the listener ipcMain.handle got. */
async function mountedListener(): Promise<IpcListener> {
  vi.resetModules();
  const electron = await import('electron');
  const { registerHandler, mountRouter } = await import('../electron/main/ipc/router.js');
  registerHandler('system:getAppInfo', () => appInfo);
  mountRouter();
  // Read the mock's recorded calls. `handle` is a vi.fn() on a plain mock object, not a bound
  // class method, so the unbound-method concern does not apply — accessing `.mock` off it is safe.
  const handleMock = vi.mocked(electron.ipcMain).handle;
  const call = handleMock.mock.calls.find((c) => c[0] === 'system:getAppInfo');
  if (call === undefined) throw new Error('router did not register the channel');
  return call[1] as unknown as IpcListener;
}

const envelope = { requestId: 'r1', payload: {} };

/**
 * Only the top frame of our own window may call IPC. The CSP already forbids frames, so this is
 * defense-in-depth against a future CSP regression — but the router is the foundation every
 * channel inherits, so the check is proven here rather than assumed.
 */
describe('the router rejects IPC from anything but the top frame', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('serves a call from the top frame (parent === null)', async () => {
    const listen = await mountedListener();
    const result = await listen({ senderFrame: { parent: null } }, envelope);
    expect(result.ok).toBe(true);
  });

  it('rejects a call from a subframe (parent !== null)', async () => {
    const listen = await mountedListener();
    const result = await listen({ senderFrame: { parent: { url: 'about:blank' } } }, envelope);
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('IPC_CONTRACT_VIOLATION');
  });
});

/**
 * Regression: a generic error must never hide a cause the handler explained.
 *
 * The bug this guards: every thrown error became "Something went wrong handling that action.", and
 * the log recorded only `error.name`. A handler could write a precise sentence about a missing key
 * or a timeout and have it discarded — leaving the failure undiagnosable from the UI AND from the
 * log at the same time.
 *
 * Both halves are asserted, because they protect different things: authored errors must survive,
 * and unexpected errors must still be redacted (a stack carries absolute paths — Security §9).
 */
/**
 * Regression: a generic error must never hide a cause the handler explained.
 *
 * The bug this guards: every thrown error became "Something went wrong handling that action.", and
 * the log recorded only `error.name`. A handler could write a precise sentence about a missing key
 * or a timeout and have it discarded — leaving the failure undiagnosable from the UI AND from the
 * log at the same time.
 *
 * Both halves are asserted, because they protect different things: authored errors must survive,
 * and unexpected errors must still be redacted (a stack carries absolute paths — Security §9).
 */
describe('handler errors: authored vs unexpected', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /** Mount the router with a handler that throws `error`, and invoke it. */
  async function throwing(error: unknown): Promise<{ message: string; actionType: string }> {
    vi.resetModules();
    const electron = await import('electron');
    const { registerHandler, mountRouter } = await import('../electron/main/ipc/router.js');
    registerHandler('system:getAppInfo', () => {
      throw error;
    });
    mountRouter();
    const call = vi
      .mocked(electron.ipcMain)
      .handle.mock.calls.find((c) => c[0] === 'system:getAppInfo');
    if (call === undefined) throw new Error('router did not register the channel');
    const listen = call[1] as unknown as IpcListener;
    const result = (await listen({ senderFrame: { parent: null } }, envelope)) as {
      ok: boolean;
      error: { message: string; action: { type: string } };
    };
    expect(result.ok).toBe(false);
    return { message: result.error.message, actionType: result.error.action.type };
  }

  it('passes an authored UserFacingError through verbatim', async () => {
    const { UserFacingError } = await import('@fixora/shared-types');
    const out = await throwing(
      new UserFacingError('Add your provider key in Settings → AI.', {
        code: 'no_key',
        action: { type: 'open_settings', label: 'Open Settings' },
      }),
    );
    expect(out.message).toBe('Add your provider key in Settings → AI.');
    expect(out.message).not.toContain('Something went wrong');
    expect(out.actionType).toBe('open_settings');
  });

  it('still redacts an unexpected throw', async () => {
    // A real crash: the message can contain an absolute path, which must not reach the renderer.
    const out = await throwing(new Error('ENOENT: no such file C:/Users/someone/secret/x.ts'));
    expect(out.message).toBe('Something went wrong handling that action.');
    expect(out.message).not.toContain('Users');
  });

  it('does not mistake a plain error merely NAMED UserFacingError for an authored one', async () => {
    // The guard is structural, not name-only: an accidental or hostile `name` must not smuggle a
    // raw message — and its paths — to the renderer.
    const impostor = new Error('C:/Users/someone/leaked.ts');
    impostor.name = 'UserFacingError';
    const out = await throwing(impostor);
    expect(out.message).toBe('Something went wrong handling that action.');
  });
});
