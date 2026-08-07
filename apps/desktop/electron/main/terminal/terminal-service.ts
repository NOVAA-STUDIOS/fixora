import * as pty from 'node-pty';

/**
 * The integrated terminal's PTY sessions. One `pty.IPty` per tab, keyed by the renderer-minted id
 * `terminal:create` was called with — main never has to hand back a session handle for the
 * renderer to hold, which keeps the create/write/resize/dispose contract free of anything but
 * strings and numbers (Security §9: no process handle ever crosses the IPC boundary).
 *
 * Windows gets `cmd.exe`; everything else gets the user's login shell (`$SHELL`, falling back to
 * `bash`) — `cmd.exe` does not exist off Windows, and guessing a POSIX shell on Windows would be
 * wrong for the common case there too.
 */
export type TerminalService = {
  create(id: string, cwd: string, cols: number, rows: number): string;
  write(id: string, data: string): void;
  resize(id: string, cols: number, rows: number): void;
  dispose(id: string): void;
  disposeAll(): void;
};

function shellFor(): string {
  if (process.platform === 'win32') return 'cmd.exe';
  return process.env['SHELL'] ?? 'bash';
}

export function createTerminalService(deps: {
  onData: (id: string, data: string) => void;
  onExit: (id: string, exitCode: number) => void;
}): TerminalService {
  const sessions = new Map<string, pty.IPty>();

  return {
    create(id, cwd, cols, rows) {
      // Re-creating an id the renderer already has open would leak the old process — a fresh tab
      // always gets a fresh id, so this is a contract violation, not a normal path.
      if (sessions.has(id)) {
        throw new Error(`terminal session already exists: ${id}`);
      }
      const shell = shellFor();
      const child = pty.spawn(shell, [], {
        name: 'xterm-256color',
        cols,
        rows,
        cwd,
        env: process.env,
      });
      sessions.set(id, child);
      child.onData((data) => {
        deps.onData(id, data);
      });
      child.onExit(({ exitCode }) => {
        sessions.delete(id);
        deps.onExit(id, exitCode);
      });
      return shell;
    },

    write(id, data) {
      sessions.get(id)?.write(data);
    },

    resize(id, cols, rows) {
      // A shell mid-command can be resized between the render loop's frames; node-pty ignores a
      // resize on a session that has already exited rather than throwing, so no guard is needed
      // beyond "the session still exists".
      sessions.get(id)?.resize(cols, rows);
    },

    dispose(id) {
      const child = sessions.get(id);
      if (child === undefined) return;
      sessions.delete(id);
      child.kill();
    },

    disposeAll() {
      for (const [id, child] of sessions) {
        sessions.delete(id);
        child.kill();
      }
    },
  };
}
