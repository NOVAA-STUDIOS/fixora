import { join } from 'node:path';

import { BrowserWindow, Notification, app } from 'electron';

import { registerHandler } from '../router.js';

/**
 * OS-level notifications.
 *
 * Gated on the app being UNFOCUSED, and that gate is the whole design. Every caller also raises an
 * in-app toast, so firing an OS notification while the user is looking at the window would say the
 * same thing twice — once in a tray popup they did not need. A notification is for the case where
 * the app cannot reach them: watch mode fixing something while they work elsewhere, an update
 * arriving, a limit reached mid-background-run.
 *
 * Content is caller-supplied and validated by the contract, but it is never HTML — Electron's
 * `Notification` renders plain text, so a title carrying markup is displayed, not interpreted.
 */
export function registerNotificationHandlers(): void {
  registerHandler('notifications:show', ({ title, body, urgency }) => {
    // The OS may have no notification support at all (a stripped container, a policy-locked
    // Windows install). Asking first turns a throw into an honest `shown: false`.
    if (!Notification.isSupported()) return { shown: false };

    const focused = BrowserWindow.getAllWindows().some((window) => window.isFocused());
    if (focused) return { shown: false };

    // `extraResources` puts the window icon beside the asar in packaged builds
    // (electron-builder.yml); in dev it sits in the repo. Missing is not fatal — Electron falls
    // back to the app icon rather than failing the notification.
    const icon = app.isPackaged
      ? join(process.resourcesPath, 'icon.png')
      : join(app.getAppPath(), 'build', 'icon.png');

    const notification = new Notification({
      title,
      body,
      icon,
      // 'critical' keeps it on screen until dismissed on Linux; Windows/macOS ignore it. Passed
      // through rather than mapped, so the caller's intent survives on the platform that honours it.
      urgency: urgency ?? 'normal',
    });

    // Clicking a notification about this app should bring this app forward — anything else makes
    // the notification a dead end.
    notification.on('click', () => {
      const [window] = BrowserWindow.getAllWindows();
      if (window === undefined || window.isDestroyed()) return;
      if (window.isMinimized()) window.restore();
      window.show();
      window.focus();
    });

    notification.show();
    return { shown: true };
  });
}
