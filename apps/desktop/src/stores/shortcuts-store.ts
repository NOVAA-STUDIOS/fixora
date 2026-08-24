import { create } from 'zustand';

type ShortcutsState = {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
};

/** The keyboard-shortcuts panel's open state. Not persisted — like the command palette, reopening
 * across a restart would be a bug, not a feature. */
export const useShortcutsStore = create<ShortcutsState>((set) => ({
  isOpen: false,
  open: () => {
    set({ isOpen: true });
  },
  close: () => {
    set({ isOpen: false });
  },
  toggle: () => {
    set((s) => ({ isOpen: !s.isOpen }));
  },
}));
