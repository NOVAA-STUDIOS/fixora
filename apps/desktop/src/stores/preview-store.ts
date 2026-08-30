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

  open: (url: string) => Promise<void>;
  close: () => Promise<void>;
  refresh: () => Promise<void>;
  detect: () => Promise<void>;
  /** Subscribes to all push events; returns the unsubscribe. Call once per consumer. */
  listen: () => () => void;
};

export const usePreviewStore = create<PreviewState>((set) => ({
  isOpen: false,
  url: null,
  port: null,
  framework: null,
  isLoading: false,
  title: '',
  detectedUrl: null,

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
