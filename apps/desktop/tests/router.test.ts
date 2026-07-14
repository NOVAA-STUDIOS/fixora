import type { AppInfo } from '@fixora/shared-types';
import { describe, expect, it, vi, beforeEach } from 'vitest';

// The startup assertion under test does not touch ipcMain; a light stub keeps the import happy.
vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
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

  it('passes once every channel has a handler', async () => {
    const { assertEveryChannelIsHandled, registerHandler } = await freshRouter();
    registerHandler('system:getAppInfo', () => appInfo);
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
