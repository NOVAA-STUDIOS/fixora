import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * User-defined shortcuts created via Zappr's `create_shortcut` action. Kept separate from the
 * static registry in `registry.ts` (Command.keybinding is fixed at registration time) — these are
 * additive bindings `command-provider.tsx` also checks, one command can now fire from either its
 * built-in binding or a user override, with the built-in always taking precedence on conflict.
 */
export type UserKeybinding = {
  commandId: string;
  /** Internal form: lowercase, `+`-joined, `mod` for Ctrl/Cmd — same format as Command.keybinding. */
  keys: string;
  /** Display form for the UI, e.g. "Ctrl+Shift+B". */
  displayKeys: string;
  description: string;
};

type UserKeybindingsState = {
  bindings: UserKeybinding[];
  setBinding: (binding: UserKeybinding) => void;
};

export const useUserKeybindingsStore = create<UserKeybindingsState>()(
  persist(
    (set) => ({
      bindings: [],
      setBinding: (binding) => {
        set((s) => ({
          bindings: [...s.bindings.filter((b) => b.keys !== binding.keys), binding],
        }));
      },
    }),
    { name: 'fixora.userKeybindings' },
  ),
);

/** "Ctrl+Shift+B" → "mod+shift+b" — the same normalised form `matchesBinding` expects. */
export function toInternalBinding(displayKeys: string): string {
  return displayKeys
    .split('+')
    .map((p) => {
      const lower = p.trim().toLowerCase();
      return lower === 'ctrl' || lower === 'cmd' ? 'mod' : lower;
    })
    .join('+');
}
