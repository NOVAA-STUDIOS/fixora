import { app } from 'electron';

import { isMcpEnabled } from './lib/mcp-setting.js';
import { startMcpServer } from './mcp/mcp-server.js';

/**
 * MCP-only mode: a headless process that serves the stdio MCP protocol and nothing else.
 *
 * Why this exists at all: `requestSingleInstanceLock()` makes a second launch quit immediately, so
 * `Fixora.exe --mcp` spawned by an MCP client while the app was already open exited silently and
 * the client saw a dead pipe. The lock is right for the GUI (two windows fighting over one
 * workspace is nonsense) and wrong for this — an MCP client owns its own child process by design.
 *
 * The lock is therefore SKIPPED in this mode, which means the database can have two writers. That
 * is safe here specifically because the driver opens it in WAL with `busy_timeout = 5000`
 * (`node-sqlite-driver.ts`): WAL supports concurrent readers with one writer at a time, and the
 * timeout makes a contended write wait rather than throw. It is not the free-for-all the
 * single-instance comment warns about — but see the repair-count note in `repair-limit.ts`, which
 * is a plain JSON file and has no such protection.
 *
 * No window, no tray, no dock icon: an MCP server that pops a window onto someone's screen when
 * their editor starts is a bug, not a feature.
 */
export function isMcpOnlyLaunch(): boolean {
  return process.argv.includes('--mcp') || process.env['MCP_ENABLED'] === '1';
}

export function startMcpOnly(
  startBackend: (window: null) => void,
  markRunning: () => void,
): void {
  // Never in the dock/taskbar — this process has no UI to switch to.
  app.dock?.hide();

  app.whenReady().then(
    () => {
      // The same backend the GUI builds: services, repair limit, and every IPC handler. The MCP
      // server calls those handlers directly (`getHandler`), so it needs the full registry — a
      // trimmed-down copy would be a second definition of what the app can do, free to drift.
      startBackend(null);

      if (!isMcpEnabled()) {
        // Consent is still required. Refusing loudly on stderr (never stdout, which carries the
        // JSON-RPC stream) tells whoever spawned us why the pipe is about to close.
        console.error(
          '[mcp] refusing to serve: MCP is not enabled in Fixora (Settings → MCP Server). Exiting.',
        );
        app.exit(1);
        return;
      }

      startMcpServer();
      markRunning();
      console.error('[mcp] standalone mode ready (no window)');

      // The client owns this process's lifetime: when it closes the pipe, the session is over and
      // lingering would leave an orphan holding a database connection.
      process.stdin.on('close', () => {
        console.error('[mcp] stdin closed — exiting');
        app.quit();
      });
      process.stdin.on('end', () => {
        app.quit();
      });
    },
    (error: unknown) => {
      console.error('[mcp] failed to start', error);
      app.exit(1);
    },
  );

  // Without a window, `window-all-closed` would fire immediately and quit the app on some
  // platforms. This mode ends when stdin does, not when a window count hits zero.
  app.on('window-all-closed', () => {
    // Intentionally empty — see above.
  });
}
