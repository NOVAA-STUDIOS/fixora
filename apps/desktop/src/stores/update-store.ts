import { create } from 'zustand';

import { subscribe } from '../lib/bridge.js';

/**
 * Auto-update state, pushed from main (`update:available` / `update:downloaded`) — this store never
 * initiates a check itself, it only reflects what main already decided.
 *
 * Two states, not a boolean plus a version: `'available'` and `'downloaded'` read differently (one
 * is informational, the other asks for a click), and collapsing them would make the banner guess
 * which copy to show from a version string that means the same thing in both.
 */
export type UpdateState = { status: 'idle' } | { status: 'available' | 'downloaded'; version: string };

type UpdateStoreState = {
  update: UpdateState;
  setAvailable: (version: string) => void;
  setDownloaded: (version: string) => void;
  /** Subscribes to both push events; returns the unsubscribe. Call once, from the banner. */
  listen: () => () => void;
};

export const useUpdateStore = create<UpdateStoreState>((set) => ({
  update: { status: 'idle' },
  setAvailable: (version) => {
    set({ update: { status: 'available', version } });
  },
  setDownloaded: (version) => {
    // Downloaded supersedes available outright — there is nothing left to wait for once this
    // arrives, so no code path needs to compare the two versions against each other.
    set({ update: { status: 'downloaded', version } });
  },

  listen: () => {
    const offAvailable = subscribe('update:available', ({ version }) => {
      set({ update: { status: 'available', version } });
    });
    const offDownloaded = subscribe('update:downloaded', ({ version }) => {
      set({ update: { status: 'downloaded', version } });
    });
    return () => {
      offAvailable();
      offDownloaded();
    };
  },
}));
