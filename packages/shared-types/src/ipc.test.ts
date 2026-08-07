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
      'system:revealInFolder',
      'system:copyToClipboard',
      'window:minimize',
      'window:toggleMaximize',
      'window:close',
      'window:isMaximized',
      'workspace:pickFolder',
      'workspace:open',
      'workspace:recent',
      'workspace:removeRecent',
      'workspace:clearRecent',
      'workspace:current',
      'workspace:close',
      'workspace:setPinned',
      'fs:listDir',
      'fs:readFile',
      'fs:writeFile',
      'fs:createFile',
      'fs:createDir',
      'fs:rename',
      'fs:delete',
      'analysis:run',
      'analysis:cancel',
      'analysis:list',
      'analysis:summary',
      // Provider management. Read, the registry mutations, and the per-provider credential writes —
      // which are now the ONLY way key material moves: the single-slot 'ai:setKey'/'ai:clearKey'
      // pair is gone, along with the v1 store it wrote.
      'providers:list',
      'providers:setEnabled',
      'providers:moveUp',
      'providers:moveDown',
      'providers:setModel',
      'providers:listModels',
      'providers:setBaseUrl',
      'providers:setKey',
      'providers:clearKey',
      'consent:get',
      'consent:accept',
      'consent:decline',
      'ai:getConfig',
      'ai:setModel',
      'ai:listModels',
      'ai:run',
      'ai:cancel',
      'ai:applyRepair',
      'ai:history',
      'ai:historyRemove',
      'ai:historyClear',
      'proceed:run',
      'proceed:cancel',
      'license:get',
      'license:activate',
      'license:deactivate',
      'suggestions:submit',
      'suggestions:list',
      'suggestions:remove',
      'suggestions:clear',
      'suggestions:export',
      'suggestions:share',
      'suggestions:shareViaGmail',
      'update:install',
      'terminal:create',
      'terminal:write',
      'terminal:resize',
      'terminal:dispose',
      'search:query',
      'packages:list',
      'packages:search',
      'editor:formatFile',
      'editor:gitBlame',
      'git:status',
      'git:stage',
      'git:unstage',
      'git:commit',
      'project:create',
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
      commit: 'abc1234',
      builtAt: '2026-08-04T00:00:00.000Z',
      dirty: false,
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
