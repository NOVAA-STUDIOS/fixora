import { app } from 'electron';

import type { ConsentStore } from '../../consent/consent-store.js';
import { registerHandler } from '../router.js';

/**
 * First-run agreement to the Terms and Privacy Policy.
 *
 * Three channels and no state of its own: whether consent exists is the store's answer, and the
 * renderer only relays the user's click. Declining quits, which is the honest reading of "I do not
 * agree" for an app whose terms cover using it at all.
 */
export function registerConsentHandlers(deps: { consent: ConsentStore }): void {
  registerHandler('consent:get', () => ({ accepted: deps.consent.isAccepted() }));

  registerHandler('consent:accept', () => {
    deps.consent.accept();
    // Reported back rather than assumed: if the write failed, the store still answers false and the
    // user is asked again next launch instead of the app claiming an agreement it did not record.
    return { accepted: deps.consent.isAccepted() };
  });

  registerHandler('consent:decline', () => {
    // Quit AFTER this call returns, so the reply reaches the renderer and the IPC channel is not
    // torn down mid-response — which the router would surface as a failed invoke on the way out.
    setImmediate(() => {
      app.quit();
    });
    return {};
  });
}
