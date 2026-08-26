import { create } from 'zustand';

import { useUiStore } from '../../stores/ui-store.js';

export type TerminalSession = {
  id: string;
  title: string;
  /** The running foreground process (`git`, `npm`, the shell itself once idle) — polled from main
   * (terminal-service.ts), null until the first `terminal:title` event arrives. Shown in the tab
   * in preference to `title` once known, VS Code's own convention. */
  processName: string | null;
  shellId: string | undefined;
  shellLabel: string;
  /** Consumed once by the matching `TerminalInstance` right after its shell starts, then cleared —
   * how Package Manager's install/uninstall gets its own dedicated terminal instead of being typed
   * into whatever tab the user happens to have open. */
  pendingCommand: string | null;
};

type TerminalStoreState = {
  sessions: TerminalSession[];
  activeId: string | null;
  /** A second session shown side-by-side with the active one (split terminal). */
  splitId: string | null;
  addSession: (command?: string, shellId?: string) => string;
  closeSession: (id: string) => void;
  setActive: (id: string) => void;
  setSplit: (id: string | null) => void;
  takePendingCommand: (id: string) => string | null;
  setProcessName: (id: string, processName: string) => void;
  setShellLabel: (id: string, shellLabel: string) => void;
  /** User-renamed tab title (renderer-side metadata only, no IPC — the PTY itself is unaware). */
  renameSession: (id: string, title: string) => void;
  /** Package Manager's entry point: a fresh terminal, running this command, with the Terminal tab
   * brought to front. */
  openWithCommand: (command: string) => void;
};

export const useTerminalStore = create<TerminalStoreState>((set, get) => ({
  sessions: [],
  activeId: null,
  splitId: null,

  addSession: (command, shellId) => {
    const id = crypto.randomUUID();
    const title = `Terminal ${String(get().sessions.length + 1)}`;
    set((s) => ({
      sessions: [
        ...s.sessions,
        { id, title, processName: null, shellId, shellLabel: '', pendingCommand: command ?? null },
      ],
      activeId: id,
    }));
    return id;
  },

  closeSession: (id) => {
    set((s) => {
      const index = s.sessions.findIndex((session) => session.id === id);
      if (index === -1) return s;
      const next = s.sessions.filter((session) => session.id !== id);
      const activeId =
        s.activeId === id ? (next[index - 1]?.id ?? next[index]?.id ?? null) : s.activeId;
      return { sessions: next, activeId, splitId: s.splitId === id ? null : s.splitId };
    });
  },

  setActive: (id) => {
    set({ activeId: id });
  },

  setSplit: (id) => {
    set({ splitId: id });
  },

  takePendingCommand: (id) => {
    const session = get().sessions.find((s) => s.id === id);
    const command = session?.pendingCommand ?? null;
    if (command !== null) {
      set((s) => ({
        sessions: s.sessions.map((sess) =>
          sess.id === id ? { ...sess, pendingCommand: null } : sess,
        ),
      }));
    }
    return command;
  },

  setProcessName: (id, processName) => {
    set((s) => ({
      sessions: s.sessions.map((sess) => (sess.id === id ? { ...sess, processName } : sess)),
    }));
  },

  setShellLabel: (id, shellLabel) => {
    set((s) => ({
      sessions: s.sessions.map((sess) => (sess.id === id ? { ...sess, shellLabel } : sess)),
    }));
  },

  renameSession: (id, title) => {
    set((s) => ({
      sessions: s.sessions.map((sess) => (sess.id === id ? { ...sess, title } : sess)),
    }));
  },

  openWithCommand: (command) => {
    get().addSession(command);
    useUiStore.getState().setActiveView('terminal');
  },
}));
