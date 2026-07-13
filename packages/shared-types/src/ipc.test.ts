import { describe, expect, it } from 'vitest';

import { channels, contracts, isChannel } from './ipc.js';

describe('the IPC contract registry', () => {
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

  it('recognises only declared channels', () => {
    expect(isChannel('system:getAppInfo')).toBe(true);
    expect(isChannel('fs:readFile')).toBe(false);
    expect(isChannel('__proto__')).toBe(false);
  });

  it('enumerates its whole surface', () => {
    // If this number goes up, someone widened the renderer's reach into the privileged
    // process. That should be a visible line in a diff, which is what this assertion makes it.
    expect(channels).toEqual(['system:getAppInfo']);
  });
});
