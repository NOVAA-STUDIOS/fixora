import type { Session, User } from '@supabase/supabase-js';
import { create } from 'zustand';

import { invoke, subscribe } from '../../lib/bridge.js';
import { supabase } from '../../lib/supabase.js';

type AuthState = {
  user: User | null;
  session: Session | null;
  loading: boolean;
  error: string | null;
  /** Sign-in is optional (only repair and purchase need it) — this toggles the overlay, it never
   * gates the app itself. */
  showSignIn: boolean;
  setShowSignIn: (open: boolean) => void;
  signInWithGoogle: () => Promise<void>;
  signInWithGitHub: () => Promise<void>;
  signOut: () => Promise<void>;
  getSession: () => Promise<void>;
};

/**
 * PKCE + loopback OAuth (RFC 8252) implemented per RFC 8252.
 *
 * The whole exchange — starting the flow, running the loopback listener, verifying the state
 * nonce, exchanging the code for a session — happens in main (`auth.handlers.ts`); this only
 * asks main to start it and waits for `auth:oauthResult`. Nothing here ever sees an authorization
 * code, a state nonce, or a code verifier, which is the point: none of that material can be
 * trusted on the renderer side of the process boundary.
 */
async function openOAuthUrl(
  set: (partial: Partial<AuthState>) => void,
  provider: 'google' | 'github',
): Promise<void> {
  set({ error: null });
  const result = await invoke('auth:startOAuth', { provider });
  if (!result.ok) {
    console.error('[auth] auth:startOAuth transport failure', { message: result.error.message });
    set({ error: 'Could not start sign-in.' });
    return;
  }
  // The real outcome always arrives as `auth:oauthResult` — `ok: false` here just means the flow
  // ran to completion one way or the other; a refusal already carries its own message via the
  // event, so nothing further is set from this response.
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  session: null,
  loading: true,
  error: null,
  showSignIn: false,

  setShowSignIn: (open) => {
    set({ showSignIn: open });
  },

  getSession: async () => {
    const { data } = await supabase.auth.getSession();
    set({ session: data.session, user: data.session?.user ?? null, loading: false });
  },

  signInWithGoogle: async () => {
    await openOAuthUrl(set, 'google');
  },

  signInWithGitHub: async () => {
    await openOAuthUrl(set, 'github');
  },

  signOut: async () => {
    await supabase.auth.signOut();
    set({ user: null, session: null });
  },
}));

supabase.auth.onAuthStateChange((_event, session) => {
  useAuthStore.setState({
    session,
    user: session?.user ?? null,
    loading: false,
    // A completed sign-in closes the overlay itself — nothing else drives it shut.
    ...(session !== null ? { showSignIn: false } : null),
  });
});

// Guarded on the preload bridge existing: this runs as a MODULE-LOAD side effect, so any test that
// imports this store (or anything that imports it, like `activity-rail.tsx`) without stubbing
// `window.fixora` would otherwise crash on import alone, before the test body even runs.
// `window.fixora` is declared as always-present by the bridge's own types, so TypeScript sees this
// check as redundant — it is not: in a test environment the preload never ran and the property is
// genuinely absent at runtime, which is the whole reason for the guard.
/** True while a callback is being exchanged for a session. A second callback arriving mid-exchange
 *  is a duplicate delivery, not a new sign-in — completing it twice races two `setSession` calls
 *  against each other and can leave the later, stale one as the winner. */
let isProcessingCallback = false;

/**
 * Only the NEWEST module evaluation's listener acts.
 *
 * `subscribe` here is a MODULE-LOAD side effect, so anything that re-evaluates this module — Vite's
 * HMR in dev — stacks another listener, and one callback then fans out to all of them. Refusing to
 * re-subscribe is the wrong fix and was tried: each evaluation also creates a NEW `useAuthStore`,
 * so keeping only the FIRST listener leaves it writing to a store that nothing renders from any
 * more. That is a session that completes correctly and a UI that never notices.
 *
 * A generation counter on `window` (which survives re-evaluation) fixes both halves: every
 * evaluation subscribes and claims the newest generation, older listeners see they are stale and
 * return, and the one that acts is always the one holding the store the components are reading.
 */
const GENERATION_KEY = '__fixoraAuthCallbackGeneration';
const globalState = window as unknown as Record<string, number>;
const myGeneration = (globalState[GENERATION_KEY] ?? 0) + 1;
globalState[GENERATION_KEY] = myGeneration;

if (typeof window !== 'undefined' && (window.fixora as unknown) !== undefined) {
  subscribe('auth:oauthResult', ({ session, error }) => {
    if (globalState[GENERATION_KEY] !== myGeneration) {
      // A newer evaluation of this module owns the live store; this listener's `useAuthStore` is
      // orphaned and writing to it would update nothing the UI reads.
      return;
    }
    if (isProcessingCallback) {
      console.error('[auth] ignoring duplicate oauth result — one is already being processed');
      return;
    }

    // Presence only — never the token values themselves.
    console.error('[auth] oauth result received', {
      hasSession: session !== null,
      hasError: error !== undefined,
    });

    if (session === null) {
      useAuthStore.setState({ error: error ?? 'Sign-in did not complete. Please try again.' });
      return;
    }

    isProcessingCallback = true;
    supabase.auth
      .setSession({ access_token: session.access_token, refresh_token: session.refresh_token })
      .then(
        ({ error: setSessionError }) => {
          isProcessingCallback = false;
          console.error('[auth] setSession result', { ok: setSessionError === null });
          if (setSessionError) {
            useAuthStore.setState({ error: setSessionError.message });
            return;
          }
          // Re-read rather than trusting only the value `setSession` handed back: the client has
          // just persisted the session, and `getSession()` is what every other part of the app
          // (`getSession` action, next launch) reads. If those two ever disagree, the stored one is
          // the one that matters — so make the store reflect that, not the in-flight response.
          void supabase.auth.getSession().then(({ data: current }) => {
            const currentSession = current.session;
            console.error('[auth] post-setSession getSession', {
              hasSession: currentSession !== null,
            });
            if (currentSession === null) return;
            useAuthStore.setState({
              session: currentSession,
              user: currentSession.user,
              loading: false,
              showSignIn: false,
              error: null,
            });
          });
        },
        (thrown: unknown) => {
          // Cleared on the failure path too, or one thrown exchange would block every later attempt.
          isProcessingCallback = false;
          console.error('[auth] setSession threw', thrown);
          useAuthStore.setState({ error: 'Sign-in could not be completed.' });
        },
      );
  });
}
