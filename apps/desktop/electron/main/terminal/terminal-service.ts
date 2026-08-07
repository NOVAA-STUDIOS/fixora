import * as pty from 'node-pty';

import { shellById } from './shell-detection.js';

/**
 * The integrated terminal's PTY sessions. One `pty.IPty` per tab, keyed by the renderer-minted id
 * `terminal:create` was called with — main never has to hand back a session handle for the
 * renderer to hold, which keeps the create/write/resize/dispose contract free of anything but
 * strings and numbers (Security §9: no process handle ever crosses the IPC boundary).
 *
 * Shell selection: `shellId` names one of `shell-detection.ts`'s detected shells; omitted or
 * unknown falls back to the platform default (`shellById`'s own fallback), never a hard error —
 * a stale shellId from a renderer that cached an old detection list must not fail the create.
 */
export type TerminalService = {
  create(id: string, cwd: string, cols: number, rows: number, shellId?: string): string;
  write(id: string, data: string): void;
  resize(id: string, cols: number, rows: number): void;
  dispose(id: string): void;
  disposeAll(): void;
};

/** How often the running foreground process name is polled for the tab title. node-pty has no
 * change event for this — `.process` is a synchronous getter — so a light poll is the only way. */
const TITLE_POLL_MS = 1000;

export function createTerminalService(deps: {
  onData: (id: string, data: string) => void;
  onExit: (id: string, exitCode: number) => void;
  onTitle: (id: string, processName: string) => void;
}): TerminalService {
  const sessions = new Map<string, pty.IPty>();
  const titlePolls = new Map<string, NodeJS.Timeout>();
  const lastTitle = new Map<string, string>();

  return {
    create(id, cwd, cols, rows, shellId) {
      // Re-creating an id the renderer already has open would leak the old process — a fresh tab
      // always gets a fresh id, so this is a contract violation, not a normal path.
      if (sessions.has(id)) {
        throw new Error(`terminal session already exists: ${id}`);
      }
      const shell = shellById(shellId);
      const child = pty.spawn(shell.command, shell.args, {
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
        const timer = titlePolls.get(id);
        if (timer !== undefined) clearInterval(timer);
        titlePolls.delete(id);
        lastTitle.delete(id);
        deps.onExit(id, exitCode);
      });

      const timer = setInterval(() => {
        let name: string;
        try {
          name = child.process;
        } catch {
          return; // the session died between the interval firing and this read
        }
        if (name !== lastTitle.get(id)) {
          lastTitle.set(id, name);
          deps.onTitle(id, name);
        }
      }, TITLE_POLL_MS);
      titlePolls.set(id, timer);

      return shell.label;
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
      const timer = titlePolls.get(id);
      if (timer !== undefined) clearInterval(timer);
      titlePolls.delete(id);
      lastTitle.delete(id);
      if (child === undefined) return;
      sessions.delete(id);
      child.kill();
    },

    disposeAll() {
      for (const timer of titlePolls.values()) clearInterval(timer);
      titlePolls.clear();
      lastTitle.clear();
      for (const [id, child] of sessions) {
        sessions.delete(id);
        child.kill();
      }
    },
  };
}
