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
