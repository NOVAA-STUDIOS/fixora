import { createClient } from '@supabase/supabase-js';

export const supabase = createClient(
  'https://avnvwgymlmzrbppmvvgl.supabase.co',
  'sb_publishable_nXlTySou511b4UjRTJla1Q_hMSKPkrj',
  {
    auth: {
      // PKCE's code verifier must survive from the moment `signInWithOAuth` starts the flow to
      // the moment the `fixora://` callback is processed — a round trip through the system
      // browser and a separate protocol-handler dispatch, not a same-page redirect. Implicit
      // flow carries the session directly in the callback URL's hash fragment instead, so
      // there's nothing that has to persist across that boundary.
      flowType: 'implicit',
      // This window never navigates to the callback URL itself (auth-store.ts's `subscribe`
      // handles it instead) — detectSessionInUrl would just watch `window.location` for nothing.
      detectSessionInUrl: false,
    },
  },
);
