import type {
  ShareSuggestionResponse,
  ShareViaGmailResponse,
  Suggestion,
  SuggestionCategory,
} from '@fixora/shared-types';
import { create } from 'zustand';

import { invoke } from '../../lib/bridge.js';

/**
 * The outcome of a share attempt, as the UI needs it. `ipc_error` is the one outcome MailService
 * itself never produces — it means the IPC call failed unexpectedly (a genuine bug), not "no mail
 * client", so the panel can tell the two apart and never mislabel a real error as the routine "no
 * mail app configured" case.
 */
export type ShareOutcome =
  | { status: 'opened' }
  | { status: 'not_found' }
  | { status: 'no_mail_client'; to: string; subject: string; body: string }
  | { status: 'ipc_error'; message: string };

function toShareOutcome(response: ShareSuggestionResponse): ShareOutcome {
  if (response.status === 'no_mail_client') {
    return {
      status: 'no_mail_client',
      to: response.to,
      subject: response.subject,
      body: response.body,
    };
  }
  return { status: response.status };
}

/** The outcome of the Gmail web-compose fallback (Sprint F1.5). */
export type ShareViaGmailOutcome =
  | { status: 'opened' }
  | { status: 'not_found' }
  | { status: 'browser_failed' }
  | { status: 'ipc_error'; message: string };

function toShareViaGmailOutcome(response: ShareViaGmailResponse): ShareViaGmailOutcome {
  return { status: response.status };
}

/**
 * Suggestion System state (Sprint F1). The list of record lives in local SQLite; this holds the
 * current view of it, reloaded on demand — the same pattern `history-store.ts` uses for the repair
 * audit trail. `submitting`/`error` are ephemeral UI state the form reads directly, so the form does
 * not need its own copy of "is a request in flight".
 */
type SuggestionsState = {
  suggestions: Suggestion[];
  loaded: boolean;
  submitting: boolean;
  error: string | null;

  refresh: () => Promise<void>;
  /** Validates and persists on the main side; returns whether it succeeded. */
  submit: (category: SuggestionCategory, message: string) => Promise<boolean>;
  remove: (id: string) => Promise<void>;
  clear: () => Promise<void>;
  /** Returns the destination path, or null if the user cancelled the save dialog. */
  exportToFile: () => Promise<string | null>;
  /** Opens the user's default mail client with the suggestion pre-filled in — see `MailService`
   *  (Sprint F1.4) for how "no mail client" is now detected up front on every platform. */
  share: (id: string) => Promise<ShareOutcome>;
  /** Opens Gmail's web compose UI as a fallback (Sprint F1.5), offered when `share` reports
   *  `no_mail_client`. */
  shareViaGmail: (id: string) => Promise<ShareViaGmailOutcome>;
  clearError: () => void;
};

export const useSuggestionsStore = create<SuggestionsState>((set) => ({
  suggestions: [],
  loaded: false,
  submitting: false,
  error: null,

  refresh: async () => {
    const result = await invoke('suggestions:list', {});
    set({ suggestions: result.ok ? result.value.suggestions : [], loaded: true });
  },

  submit: async (category, message) => {
    set({ submitting: true, error: null });
    const result = await invoke('suggestions:submit', { category, message });
    if (result.ok) {
      set((s) => ({
        submitting: false,
        suggestions: [result.value.suggestion, ...s.suggestions],
      }));
      return true;
    }
    set({ submitting: false, error: result.error.message });
    return false;
  },

  remove: async (id) => {
    const result = await invoke('suggestions:remove', { id });
    if (result.ok) set({ suggestions: result.value.suggestions });
  },

  clear: async () => {
    const result = await invoke('suggestions:clear', {});
    if (result.ok) set({ suggestions: result.value.suggestions });
  },

  exportToFile: async () => {
    const result = await invoke('suggestions:export', {});
    return result.ok ? result.value.path : null;
  },

  share: async (id) => {
    const result = await invoke('suggestions:share', { id });
    if (!result.ok) return { status: 'ipc_error', message: result.error.message };
    return toShareOutcome(result.value);
  },

  shareViaGmail: async (id) => {
    const result = await invoke('suggestions:shareViaGmail', { id });
    if (!result.ok) return { status: 'ipc_error', message: result.error.message };
    return toShareViaGmailOutcome(result.value);
  },

  clearError: () => {
    set({ error: null });
  },
}));
