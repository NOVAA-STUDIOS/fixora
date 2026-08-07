import { create } from 'zustand';

import { useUiStore } from '../../stores/ui-store.js';

export type TerminalSession = {
  id: string;
  title: string;
  /** Consumed once by the matching `TerminalInstance` right after its shell starts, then cleared —
   * how Package Manager's install/uninstall gets its own dedicated terminal instead of being typed
   * into whatever tab the user happens to have open. */
  pendingCommand: string | null;
};

type TerminalStoreState = {
  sessions: TerminalSession[];
  activeId: string | null;
  /** Creates a session and returns its id. `command`, if given, is queued for that session alone. */
  addSession: (command?: string) => string;
  closeSession: (id: string) => void;
  setActive: (id: string) => void;
  takePendingCommand: (id: string) => string | null;
  /** Package Manager's entry point: a fresh terminal, running this command, with the Terminal tab
   * brought to front. */
  openWithCommand: (command: string) => void;
};

export const useTerminalStore = create<TerminalStoreState>((set, get) => ({
  sessions: [],
  activeId: null,

  addSession: (command) => {
    const id = crypto.randomUUID();
    const title = `Terminal ${String(get().sessions.length + 1)}`;
    set((s) => ({
      sessions: [...s.sessions, { id, title, pendingCommand: command ?? null }],
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
      return { sessions: next, activeId };
    });
  },

  setActive: (id) => {
    set({ activeId: id });
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

  openWithCommand: (command) => {
    get().addSession(command);
    useUiStore.getState().setActiveView('terminal');
  },
}));
