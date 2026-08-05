import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Whether the user has accepted the Terms and Privacy Policy.
 *
 * One boolean in `userData/consent.json`, deliberately its own file rather than a key in an existing
 * settings blob: this is the only piece of state whose loss changes what the user is asked to agree
 * to, and burying it alongside theme preferences invites it being cleared by an unrelated reset.
 *
 * An unreadable or missing file means NOT accepted. That is the safe direction — the cost of asking
 * twice is a click, and the cost of never asking is shipping an app that claims agreement it never
 * obtained.
 *
 * The accepted terms are versioned by date so a future revision can ask again without a migration:
 * a stored date older than `CURRENT_TERMS` is treated as unaccepted.
 */

/** Bumping this re-prompts everyone. Must match the effective date on the published pages. */
export const CURRENT_TERMS = '2026-08-05';

interface StoredConsent {
  acceptedTerms: string | null;
  acceptedAt: string | null;
}

export interface ConsentStore {
  /** True only when the CURRENT terms have been accepted. */
  isAccepted(): boolean;
  accept(): void;
}

export interface ConsentStoreOptions {
  dir: string;
  fileName?: string;
}

export function createConsentStore(options: ConsentStoreOptions): ConsentStore {
  const file = join(options.dir, options.fileName ?? 'consent.json');

  function load(): StoredConsent {
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<StoredConsent>;
      return {
        acceptedTerms: typeof parsed.acceptedTerms === 'string' ? parsed.acceptedTerms : null,
        acceptedAt: typeof parsed.acceptedAt === 'string' ? parsed.acceptedAt : null,
      };
    } catch {
      // Missing on a fresh install, corrupt in the rare bad case. Both mean "ask".
      return { acceptedTerms: null, acceptedAt: null };
    }
  }

  let state = load();

  return {
    isAccepted: () => state.acceptedTerms === CURRENT_TERMS,

    accept() {
      state = { acceptedTerms: CURRENT_TERMS, acceptedAt: new Date().toISOString() };
      // A failed write must not silently pretend consent was recorded — it would be re-asked next
      // launch, which is mildly annoying and entirely honest. Throwing here would block launch over
      // a disk problem, which is worse.
      try {
        writeFileSync(file, JSON.stringify(state), { encoding: 'utf8', mode: 0o600 });
      } catch (error) {
        console.error('[consent] could not persist acceptance', {
          detail: error instanceof Error ? error.message : String(error),
        });
      }
    },
  };
}
