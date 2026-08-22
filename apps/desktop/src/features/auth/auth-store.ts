import type { Provider, Session, User } from '@supabase/supabase-js';
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

// Supabase's default OAuth flow assumes it owns the current page and navigates the window to the
// provider — inside this app's sandboxed renderer, that navigation is exactly what
// navigation-guard.ts exists to block (Security §2), so the click did nothing and nothing was
// logged anywhere the user could see. `skipBrowserRedirect` stops Supabase from navigating at
// all; main opens the returned URL in the user's real browser instead, through the same
// host-allowlisted `system:openExternal` every other external link in the app already uses.
/**
 * KNOWN GAP — no CSRF/session-fixation defence on the callback.
 *
 * A `state` nonce was implemented here and had to be reverted: Supabase's implicit flow does not
 * round-trip `options.queryParams.state`, so the value never came back and every sign-in was
 * refused. Validating a parameter the flow cannot deliver breaks login for everyone, which is
 * worse than the gap it closes.
 *
 * The consequence, stated plainly: anything able to reach `fixora://auth/callback#access_token=…`
 * — a web page, a local process, a crafted link — can complete a sign-in this app never started,
 * logging the user into someone else's account.
 *
 * The real fix is not a nonce bolted onto implicit flow; it is to stop using implicit flow. A
 * loopback HTTP listener on 127.0.0.1 (RFC 8252) plus PKCE gives a verifier that survives the
 * browser round trip, and removes the custom-scheme hijack surface at the same time. That is a
 * refactor, not a patch, and it is the correct next piece of work on this file.
 */
async function openOAuthUrl(set: (partial: Partial<AuthState>) => void, provider: Provider): Promise<void> {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: { skipBrowserRedirect: true, redirectTo: 'fixora://auth/callback' },
  });
  if (error) {
    console.error('[auth] signInWithOAuth failed', { provider, message: error.message });
    set({ error: error.message });
    return;
  }

  // DIAGNOSTIC. Host only — the authorize URL carries client ids and redirect targets, so the URL
  // itself is never logged. Both providers take this identical path: if one works and the other
  // does not, the difference is in the provider's own configuration, not in this code.
  let host = '<unparseable>';
  try {
    host = new URL(data.url).host;
  } catch {
    // Leave the placeholder — an unparseable URL is itself the finding.
  }
  console.error('[auth] OAuth URL generated', { provider, hasUrl: data.url !== '', host });

  if (data.url === '') {
    // Supabase returned no error and no URL — almost always a provider that is not enabled in the
    // Supabase dashboard. Said plainly, because "nothing happened" is the worst possible report.
    console.error('[auth] no OAuth URL returned — is the provider enabled in Supabase?', { provider });
    set({ error: `${provider} sign-in is not available right now. Please try another method.` });
    return;
  }

  const result = await invoke('system:openExternal', { url: data.url });
  console.error('[auth] openExternal result', {
    provider,
    ok: result.ok,
    opened: result.ok ? result.value.opened : false,
    message: result.ok ? undefined : result.error.message,
  });
  if (!result.ok || !result.value.opened) {
    set({ error: 'Could not open the sign-in page.' });
  }
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

// The OAuth round trip finishes in the system browser, not this window, so Supabase's own
// `detectSessionInUrl` (which watches `window.location`) never sees the callback — main forwards
// the `fixora://auth/callback` URL here instead, and the session is completed by hand.
// `onAuthStateChange` above then picks up the result.
//
// `flowType: 'implicit'` (supabase.ts): the callback carries `#access_token=...&refresh_token=...`
// directly in the URL's hash fragment — nothing has to persist between `signInWithOAuth` starting
// the flow and this handler completing it, unlike PKCE's code verifier, which has to survive a
// round trip through the system browser and a separate protocol-handler dispatch to get back here.
//
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
  subscribe('auth:callback', ({ url }) => {
    if (globalState[GENERATION_KEY] !== myGeneration) {
      // A newer evaluation of this module owns the live store; this listener's `useAuthStore` is
      // orphaned and writing to it would update nothing the UI reads.
      return;
    }
    if (isProcessingCallback) {
      console.error('[auth] ignoring duplicate callback — one is already being processed');
      return;
    }
    const parsed = new URL(url);
    const params = new URLSearchParams(parsed.hash.slice(1));
    const accessToken = params.get('access_token');
    const refreshToken = params.get('refresh_token');

    // DIAGNOSTIC (OAuth session-not-set investigation). Presence and shape only — a token is a
    // credential and is never logged, nor is the URL that carries it.
    console.error('[auth] callback received', {
      urlLength: url.length,
      hasFragment: url.includes('#'),
      fragmentKeys: [...params.keys()],
      hasAccessToken: accessToken !== null,
      hasRefreshToken: refreshToken !== null,
      providerError: params.get('error') ?? parsed.searchParams.get('error'),
    });

    // No origin check is possible here — see the KNOWN GAP note above `openOAuthUrl`. Any callback
    // carrying a well-formed token pair completes a sign-in.
    if (accessToken === null || refreshToken === null) {
      console.error('[auth] callback carried no usable token pair — session not set');
      useAuthStore.setState({
        error: 'Sign-in did not complete. Please try again.',
      });
      return;
    }

    isProcessingCallback = true;
    supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken }).then(
      ({ data, error }) => {
        isProcessingCallback = false;
        console.error('[auth] setSession result', {
          ok: error === null,
          hasSession: data.session !== null,
          message: error?.message,
        });
        if (error) {
          useAuthStore.setState({ error: error.message });
          return;
        }
        // Re-read rather than trusting only the value `setSession` handed back: the client has
        // just persisted the session, and `getSession()` is what every other part of the app
        // (`getSession` action, next launch) reads. If those two ever disagree, the stored one is
        // the one that matters — so make the store reflect that, not the in-flight response.
        void supabase.auth.getSession().then(({ data: current }) => {
          const session = current.session ?? data.session;
          console.error('[auth] post-setSession getSession', { hasSession: session !== null });
          if (session === null) return;
          useAuthStore.setState({
            session,
            user: session.user,
            loading: false,
            showSignIn: false,
            error: null,
          });
        });

        // `onAuthStateChange` normally drives this, but it does not always fire for a
        // programmatic `setSession` — set it here too so a successful sign-in is never invisible.
        if (data.session !== null) {
          useAuthStore.setState({
            session: data.session,
            user: data.session.user,
            loading: false,
            showSignIn: false,
            error: null,
          });
        }
      },
      (error: unknown) => {
        // Cleared on the failure path too, or one thrown exchange would block every later attempt.
        isProcessingCallback = false;
        console.error('[auth] setSession threw', error);
        useAuthStore.setState({ error: 'Sign-in could not be completed.' });
      },
    );
  });
}
