import { type AppInfo } from '@fixora/shared-types';
import { app, clipboard, shell } from 'electron';

import type { WorkspaceService } from '../../services/workspace-service.js';
import { registerHandler } from '../router.js';

/**
 * The one M0 channel. It exists to prove the whole path — renderer → preload → router →
 * handler → validated response → typed Result — with a payload that carries nothing sensitive,
 * so the pattern can be reviewed on its merits before it is carrying a user's source code.
 */
export function registerSystemHandlers(deps: { workspace: WorkspaceService }): void {
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

  registerHandler('system:copyToClipboard', ({ text }) => {
    // Refuse empty writes rather than silently clearing the user's clipboard: "Copy" that wipes what
    // you had is worse than "Copy" that tells you there was nothing to copy.
    if (text.length === 0) return { copied: false };
    clipboard.writeText(text);
    return { copied: true };
  });

  registerHandler('system:revealInFolder', ({ path }) => {
    // Same rule as workspace:open — a renderer-supplied path is only honoured if the user already
    // authorized it (a pick this session, or a known recent). Without this the channel would let a
    // compromised renderer open a native file-manager window on any path it can name.
    if (!deps.workspace.isUserAuthorized(path)) return { revealed: false };
    shell.showItemInFolder(path);
    return { revealed: true };
  });
}
