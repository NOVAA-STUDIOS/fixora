import { create } from 'zustand';

/**
 * Transient feedback for actions whose success is otherwise invisible.
 *
 * Copy is the motivating case: it puts text somewhere the user cannot see, so with no confirmation
 * a working Copy and a broken Copy look **identical**. That is not a cosmetic gap — it is why a
 * clipboard permission denial went unnoticed. An action that reports nothing cannot be observed to
 * have failed.
 */
export type ToastTone = 'success' | 'error';

export type ToastItem = {
  id: string;
  tone: ToastTone;
  title: string;
  description?: string;
};

/** Long enough to read a short sentence, short enough not to sit on the UI. */
const DISMISS_AFTER_MS = 3200;

type ToastState = {
  toasts: ToastItem[];
  push: (toast: Omit<ToastItem, 'id'>) => void;
  dismiss: (id: string) => void;
};

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],

  push: (toast) => {
    const id = `${String(Date.now())}-${String(Math.random()).slice(2, 8)}`;
    set((s) => ({ toasts: [...s.toasts, { ...toast, id }] }));
    window.setTimeout(() => {
      get().dismiss(id);
    }, DISMISS_AFTER_MS);
  },

  dismiss: (id) => {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },
}));

/** Convenience wrappers, so call sites read as intent rather than as store plumbing. */
export const toast = {
  success: (title: string, description?: string): void => {
    useToastStore
      .getState()
      .push({ tone: 'success', title, ...(description !== undefined && { description }) });
  },
  error: (title: string, description?: string): void => {
    useToastStore
      .getState()
      .push({ tone: 'error', title, ...(description !== undefined && { description }) });
  },
};
