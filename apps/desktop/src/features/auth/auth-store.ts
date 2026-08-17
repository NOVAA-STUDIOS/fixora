import type { Provider, Session, User } from '@supabase/supabase-js';
import { create } from 'zustand';

import { invoke, subscribe } from '../../lib/bridge.js';
import { supabase } from '../../lib/supabase.js';

type AuthState = {
  user: User | null;
  session: Session | null;
  loading: boolean;
  error: string | null;
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
async function openOAuthUrl(set: (partial: Partial<AuthState>) => void, provider: Provider): Promise<void> {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: { skipBrowserRedirect: true, redirectTo: 'fixora://auth/callback' },
  });
  if (error) {
    set({ error: error.message });
    return;
  }
  if (data.url) {
    const result = await invoke('system:openExternal', { url: data.url });
    if (!result.ok || !result.value.opened) set({ error: 'Could not open the sign-in page.' });
  }
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  session: null,
  loading: true,
  error: null,

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
  useAuthStore.setState({ session, user: session?.user ?? null, loading: false });
});

// The OAuth round trip finishes in the system browser, not this window, so Supabase's own
// `detectSessionInUrl` (which watches `window.location`) never sees the tokens — main forwards
// the `fixora://auth/callback#access_token=...` URL here instead, and the tokens are applied by
// hand. `onAuthStateChange` above then picks up the resulting session.
subscribe('auth:callback', ({ url }) => {
  const hash = new URL(url.replace('fixora://auth/callback', 'http://fixora.local')).hash;
  const params = new URLSearchParams(hash.slice(1));
  const accessToken = params.get('access_token');
  const refreshToken = params.get('refresh_token');
  if (accessToken !== null && refreshToken !== null) {
    void supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
  }
});
