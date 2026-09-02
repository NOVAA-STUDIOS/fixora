import { create } from 'zustand';

import { invoke, subscribe } from '../lib/bridge.js';

import { toast } from './toast-store.js';

/**
 * Fixora Preview's renderer-side state — a thin reflection of `preview-service.ts`'s
 * `WebContentsView`, the same "main owns the fact, this is the view of it" split every other
 * main-process-backed store here uses (findings, update, license).
 */
type PreviewState = {
  isOpen: boolean;
  url: string | null;
  port: number | null;
  framework: string | null;
  isLoading: boolean;
  title: string;
  /** A localhost dev server the port scanner found, offered but not yet opened. */
  detectedUrl: string | null;
  /** Whether the open workspace's package.json declares a `dev` script. */
  hasDevScript: boolean;
  /** The command to run it — `pnpm dev`/`yarn dev`/`npm run dev`, whichever the project uses. */
  devCommand: string | null;

  open: (url: string) => Promise<void>;
  close: () => Promise<void>;
  refresh: () => Promise<void>;
  detect: () => Promise<void>;
  checkDevScript: () => Promise<void>;
  /** Runs the dev script as a hidden background process (main-side — no terminal involved) and
   *  opens it in the embedded view once it starts listening. */
  launchAndPreview: () => Promise<void>;
  /** Subscribes to all push events; returns the unsubscribe. Call once per consumer. */
  listen: () => () => void;
};

export const usePreviewStore = create<PreviewState>((set, get) => ({
  isOpen: false,
  url: null,
  port: null,
  framework: null,
  isLoading: false,
  title: '',
  detectedUrl: null,
  hasDevScript: false,
  devCommand: null,

  open: async (url) => {
    const result = await invoke('preview:open', { url });
    if (result.ok && result.value.ok) set({ isOpen: true, url });
  },

  close: async () => {
    const result = await invoke('preview:close', {});
    if (result.ok && result.value.ok) set({ isOpen: false, url: null, title: '' });
  },

  refresh: async () => {
    await invoke('preview:refresh', {});
  },

  detect: async () => {
    const result = await invoke('preview:detect', {});
    if (result.ok && result.value.port !== null) {
      set({ detectedUrl: result.value.url, port: result.value.port });
    }
  },

  checkDevScript: async () => {
    const result = await invoke('preview:checkDevScript', {});
    if (result.ok) {
      set({ hasDevScript: result.value.hasScript, devCommand: result.value.command });
    }
  },

  launchAndPreview: async () => {
    // First: try to detect an already-running server — skip spawning a redundant process.
    const detected = await invoke('preview:detect', {});
    if (detected.ok && detected.value.url !== null) {
      const opened = await invoke('preview:open', { url: detected.value.url });
      if (opened.ok) {
        set({ isOpen: true, url: detected.value.url, isLoading: true });
        return;
      }
    }

    if (get().devCommand === null) await get().checkDevScript();
    const cmd = get().devCommand;
    if (cmd === null) {
      set({ isLoading: false });
      return;
    }
    set({ isLoading: true });
    const result = await invoke('preview:launchAndPreview', { devCommand: cmd });
    if (result.ok && result.value.ok) {
      // `preview:serverDetected` fires from within the same main-side call, before this
      // response arrives — `detectedUrl` is already the URL that's now actually loaded.
      set({ isOpen: true, url: get().detectedUrl, isLoading: false });
    } else {
      set({ isLoading: false });
      toast.error(result.ok ? (result.value.error ?? 'Could not start the dev server') : result.error.message);
    }
  },

  listen: () => {
    const offDetected = subscribe('preview:serverDetected', ({ port, url, framework }) => {
      set({ detectedUrl: url, port, framework });
      toast.info(`🌐 Dev server detected on localhost:${String(port)} — Open Preview?`);
    });
    const offTitle = subscribe('preview:titleChanged', ({ title }) => {
      set({ title });
    });
    const offLoading = subscribe('preview:loadingChanged', ({ loading }) => {
      set({ isLoading: loading });
    });
    return () => {
      offDetected();
      offTitle();
      offLoading();
    };
  },
}));
