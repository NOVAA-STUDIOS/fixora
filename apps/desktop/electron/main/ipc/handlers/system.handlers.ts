import { type AppInfo } from '@fixora/shared-types';
import { app } from 'electron';

import { registerHandler } from '../router.js';

/**
 * The one M0 channel. It exists to prove the whole path — renderer → preload → router →
 * handler → validated response → typed Result — with a payload that carries nothing sensitive,
 * so the pattern can be reviewed on its merits before it is carrying a user's source code.
 */
export function registerSystemHandlers(): void {
  registerHandler('system:getAppInfo', (): AppInfo => {
    return {
      name: app.getName(),
      version: app.getVersion(),
      platform: process.platform as AppInfo['platform'],
      arch: process.arch,
      electronVersion: process.versions.electron,
      isPackaged: app.isPackaged,
    };
  });
}
