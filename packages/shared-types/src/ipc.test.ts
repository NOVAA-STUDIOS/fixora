import { describe, expect, it } from 'vitest';

import { channels, eventChannels, isChannel, isEventChannel } from './channels.js';
import { eventContracts } from './events.js';
import { contracts } from './ipc.js';

describe('the channel list (the zod-free surface the preload imports)', () => {
  it('recognises only declared channels', () => {
    expect(isChannel('system:getAppInfo')).toBe(true);
    expect(isChannel('fs:readFile')).toBe(true);
    expect(isChannel('fs:deleteEverything')).toBe(false);
    expect(isChannel('__proto__')).toBe(false);
  });

  it('enumerates its whole surface', () => {
    // If this list grows, someone widened the renderer's reach into the privileged process.
    // That should be a visible line in a diff, which is what this assertion makes it.
    expect(channels).toEqual([
      'system:getAppInfo',
      'window:minimize',
      'window:toggleMaximize',
      'window:close',
      'window:isMaximized',
      'workspace:pickFolder',
      'workspace:open',
      'workspace:recent',
      'workspace:current',
      'workspace:close',
      'fs:listDir',
      'fs:readFile',
      'fs:writeFile',
      'analysis:run',
      'analysis:cancel',
      'analysis:list',
      'analysis:summary',
      'ai:getConfig',
      'ai:setKey',
      'ai:clearKey',
      'ai:setModel',
      'ai:run',
      'ai:cancel',
      'ai:applyRepair',
      'ai:history',
      'license:get',
      'license:activate',
      'license:deactivate',
    ]);
  });
});

describe('the event registry (main → renderer push)', () => {
  it('recognises only declared event channels', () => {
    expect(isEventChannel('window:maximizedChanged')).toBe(true);
    expect(isEventChannel('workspace:filesChanged')).toBe(true);
    expect(isEventChannel('window:minimize')).toBe(false); // that is a request channel, not an event
  });

  it('has one schema per event channel, and no more', () => {
    expect(Object.keys(eventContracts).sort()).toEqual([...eventChannels].sort());
  });

  it('validates a maximized-changed payload', () => {
    expect(eventContracts['window:maximizedChanged'].safeParse({ isMaximized: true }).success).toBe(
      true,
    );
    expect(
      eventContracts['window:maximizedChanged'].safeParse({ isMaximized: 'yes' }).success,
    ).toBe(false);
  });
});

describe('the IPC contract registry', () => {
  it('has exactly one contract per channel, and no more', () => {
    // The `satisfies Record<Channel, Contract>` constraint enforces this at compile time; this
    // asserts it at runtime too, so a build that somehow skipped the check still fails here.
    expect(Object.keys(contracts).sort()).toEqual([...channels].sort());
  });

  it('validates a well-formed response', () => {
    const parsed = contracts['system:getAppInfo'].response.safeParse({
      name: 'Fixora',
      version: '0.1.0',
      platform: 'win32',
      arch: 'x64',
      electronVersion: '43.1.0',
      isPackaged: false,
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects a response with an unexpected shape', () => {
    // The router validates main → renderer as well as renderer → main. A handler that
    // returns the wrong shape is a bug we want to find in a test, not in a user's window.
    const parsed = contracts['system:getAppInfo'].response.safeParse({
      name: 'Fixora',
      version: '0.1.0',
      platform: 'plan9',
      arch: 'x64',
      electronVersion: '43.1.0',
      isPackaged: false,
    });
    expect(parsed.success).toBe(false);
  });
});
