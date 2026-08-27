import { createHash, randomBytes } from 'node:crypto';

import { createClient } from '@supabase/supabase-js';

import { startLoopbackServer } from '../../lib/loopback-server.js';
import { openExternal } from '../../security/navigation-guard.js';
import { emitToWindow } from '../emit.js';
import { registerHandler } from '../router.js';

/**
 * PKCE + loopback OAuth (RFC 8252) — replaces the implicit flow's known CSRF/session-fixation
 * gap (`auth-store.ts`'s old KNOWN GAP note). Everything that must be trusted — the code verifier,
 * the state nonce, the exchange itself — lives here in main; the renderer only ever sees the
 * finished session, over `auth:oauthResult`, never the material that produced it.
 *
 * A separate client from the renderer's (`src/lib/supabase.ts`): that one is `flowType: 'implicit'`
 * and reads/writes browser storage for its own session, neither of which applies to a client that
 * exists only to run one `exchangeCodeForSession` call and discard itself.
 */
const supabase = createClient(
  'https://avnvwgymlmzrbppmvvgl.supabase.co',
  'sb_publishable_nXlTySou511b4UjRTJla1Q_hMSKPkrj',
  {
    auth: {
      flowType: 'pkce',
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  },
);

export function registerAuthHandlers(): void {
  registerHandler('auth:startOAuth', async ({ provider }, { window }) => {
    const codeVerifier = randomBytes(32).toString('base64url');
    const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
    const state = randomBytes(16).toString('hex');

    let loopback;
    try {
      loopback = await startLoopbackServer();
    } catch (error) {
      console.error('[auth] loopback server failed to start', {
        message: error instanceof Error ? error.message : String(error),
      });
      if (window !== null) {
        emitToWindow(window, 'auth:oauthResult', {
          session: null,
          error: 'Could not start the local sign-in listener.',
        });
      }
      return { ok: false };
    }

    console.error('[auth] starting OAuth', { provider, port: loopback.port });

    const redirectUri = `http://127.0.0.1:${String(loopback.port)}/callback`;
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        skipBrowserRedirect: true,
        redirectTo: redirectUri,
        queryParams: {
          code_challenge: codeChallenge,
          code_challenge_method: 'S256',
          state,
        },
      },
    });

    if (error || data.url === '') {
      console.error('[auth] signInWithOAuth failed', {
        provider,
        message: error?.message,
      });
      if (window !== null) {
        emitToWindow(window, 'auth:oauthResult', {
          session: null,
          error: error?.message ?? `${provider} sign-in is not available right now.`,
        });
      }
      return { ok: false };
    }

    await openExternal(data.url);

    let callback;
    try {
      callback = await loopback.waitForCallback();
    } catch (waitError) {
      console.error('[auth] loopback callback failed', {
        message: waitError instanceof Error ? waitError.message : String(waitError),
      });
      if (window !== null) {
        emitToWindow(window, 'auth:oauthResult', {
          session: null,
          error: 'Sign-in did not complete in time. Please try again.',
        });
      }
      return { ok: false };
    }

    console.error('[auth] loopback callback received', {
      hasCode: callback.code.length > 0,
      hasState: callback.state.length > 0,
    });

    if (callback.state !== state) {
      console.error('[auth] state mismatch — refusing exchange');
      if (window !== null) {
        emitToWindow(window, 'auth:oauthResult', {
          session: null,
          error: 'State mismatch — possible CSRF attack.',
        });
      }
      return { ok: false };
    }

    const { data: exchanged, error: exchangeError } = await supabase.auth.exchangeCodeForSession(
      callback.code,
    );
    if (exchangeError) {
      console.error('[auth] code exchange failed', { message: exchangeError.message });
      if (window !== null) {
        emitToWindow(window, 'auth:oauthResult', { session: null, error: exchangeError.message });
      }
      return { ok: false };
    }

    if (window !== null) {
      emitToWindow(window, 'auth:oauthResult', {
        session: {
          access_token: exchanged.session.access_token,
          refresh_token: exchanged.session.refresh_token,
          expires_at: exchanged.session.expires_at,
        },
      });
    }
    return { ok: true };
  });
}
