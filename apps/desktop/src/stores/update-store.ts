import { create } from 'zustand';

import { notify } from '../features/notifications/notify.js';
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
  /** Download percent for the in-flight update, or `null` when nothing is downloading. */
  downloadProgress: number | null;
  /** The version currently available/downloading/downloaded — kept alongside `update` so a
   *  consumer can read "which version" without narrowing `update.status` first. */
  pendingVersion: string | null;
  setAvailable: (version: string) => void;
  setDownloaded: (version: string) => void;
  setProgress: (percent: number) => void;
  /** Subscribes to all push events; returns the unsubscribe. Call once per consumer. */
  listen: () => () => void;
};

export const useUpdateStore = create<UpdateStoreState>((set) => ({
  update: { status: 'idle' },
  downloadProgress: null,
  pendingVersion: null,
  setAvailable: (version) => {
    set({ update: { status: 'available', version }, pendingVersion: version });
  },
  setDownloaded: (version) => {
    // Downloaded supersedes available outright — there is nothing left to wait for once this
    // arrives, so no code path needs to compare the two versions against each other.
    set({ update: { status: 'downloaded', version }, pendingVersion: version, downloadProgress: null });
  },
  setProgress: (percent) => {
    set({ downloadProgress: percent });
  },

  listen: () => {
    const offAvailable = subscribe('update:available', ({ version }) => {
      set({ update: { status: 'available', version }, pendingVersion: version });
      // OS-level too: an update arriving is exactly the kind of thing that happens while the app
      // sits in the background, and the banner alone would go unseen until they next look.
      notify('info', '🚀 New Update Ready', `Version ${version} is ready to install.`, {
        alsoNotifyOs: true,
      });
    });
    const offProgress = subscribe('update:progress', ({ percent }) => {
      set({ downloadProgress: percent });
    });
    const offDownloaded = subscribe('update:downloaded', ({ version }) => {
      set({ update: { status: 'downloaded', version }, pendingVersion: version, downloadProgress: null });
    });
    return () => {
      offAvailable();
      offProgress();
      offDownloaded();
    };
  },
}));
