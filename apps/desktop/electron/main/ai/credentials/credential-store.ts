import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { UserFacingError } from '@fixora/shared-types';

import type { SecretCipher } from '../cipher.js';

/**
 * Per-provider secret storage (Security §5).
 *
 * Same guarantees the single-key store had, now keyed by provider id: each key is encrypted with the
 * OS credential store (`safeStorage` → DPAPI on Windows, Keychain on macOS, Secret Service on Linux)
 * before it touches disk, the plaintext exists only transiently in the main process when a call needs
 * it, and it is **never** returned across IPC. The renderer gets a masked hint and nothing more.
 *
 * The refusal is the important part and is unchanged: with no OS keychain available, this store
 * **fails** rather than falling back to plaintext. A provider key written in the clear to a JSON file
 * in the user's profile is worse than a provider that will not turn on, and the honest error is one
 * the user can act on.
 */

/** Bumped when the on-disk shape changes. v1 was the single-key `ai-credentials.json`. */
const SCHEMA_VERSION = 2;

/** The legacy single-provider file. Read for migration; never written, never deleted. */
export const LEGACY_CREDENTIALS_FILE = 'ai-credentials.json';
const CREDENTIALS_FILE = 'ai-providers.json';

interface StoredCredential {
  readonly keyEnc: string;
  readonly hint: string;
}

interface StoredFile {
  version: number;
  credentials: Record<string, StoredCredential>;
}

interface LegacyFile {
  keyEnc?: unknown;
  hint?: unknown;
  model?: unknown;
}

function hintFor(key: string): string {
  const tail = key.slice(-4);
  return tail.length === 0 ? '••••' : `••••${tail}`;
}

export interface CredentialStore {
  /** @throws UserFacingError when the OS keychain is unavailable. Never writes plaintext. */
  setKey(providerId: string, key: string): void;
  clearKey(providerId: string): void;
  hasKey(providerId: string): boolean;
  /** Masked, safe to send to the renderer. Null when no key is stored. */
  hint(providerId: string): string | null;
  /** Main-process only. Never expose across IPC. */
  getKey(providerId: string): string | null;
  /** Provider ids that currently hold a key. */
  configured(): readonly string[];
}

export interface CredentialStoreOptions {
  dir: string;
  cipher: SecretCipher;
  fileName?: string;
  legacyFileName?: string;
}

export function createCredentialStore(options: CredentialStoreOptions): CredentialStore {
  const file = join(options.dir, options.fileName ?? CREDENTIALS_FILE);
  const legacyFile = join(options.dir, options.legacyFileName ?? LEGACY_CREDENTIALS_FILE);
  const { cipher } = options;

  const state: StoredFile = load();

  function load(): StoredFile {
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<StoredFile>;
      const credentials: Record<string, StoredCredential> = {};
      for (const [id, entry] of Object.entries(parsed.credentials ?? {})) {
        // Per-entry validation: one corrupt provider drops itself, not every other key the user has.
        if (typeof entry.keyEnc === 'string' && typeof entry.hint === 'string') {
          credentials[id] = { keyEnc: entry.keyEnc, hint: entry.hint };
        }
      }
      return { version: SCHEMA_VERSION, credentials };
    } catch {
      // Absent or unreadable. Try the v1 file before giving up — this is the upgrade path for every
      // existing OpenRouter user, and it must not require them to paste their key again.
      return migrateLegacy();
    }
  }

  /**
   * Adopt a v1 single-key file as the OpenRouter credential.
   *
   * The ciphertext is copied VERBATIM: it was produced by the same `safeStorage` on the same machine,
   * so it decrypts unchanged, and re-encrypting would mean holding the plaintext to do it. Copying
   * bytes we never decrypt is both simpler and safer.
   *
   * The legacy file is left in place. That costs one stale file and buys a working downgrade — a
   * user who rolls back a release still finds their key where the old build looks for it.
   */
  function migrateLegacy(): StoredFile {
    try {
      const legacy = JSON.parse(readFileSync(legacyFile, 'utf8')) as LegacyFile;
      if (typeof legacy.keyEnc !== 'string' || legacy.keyEnc === '') {
        return { version: SCHEMA_VERSION, credentials: {} };
      }
      const hint = typeof legacy.hint === 'string' ? legacy.hint : '••••';
      console.error('[credentials] migrated v1 key to the provider store', { provider: 'openrouter' });
      return {
        version: SCHEMA_VERSION,
        credentials: { openrouter: { keyEnc: legacy.keyEnc, hint } },
      };
    } catch {
      return { version: SCHEMA_VERSION, credentials: {} };
    }
  }

  function persist(): void {
    writeFileSync(file, JSON.stringify(state), { encoding: 'utf8', mode: 0o600 });
  }

  return {
    setKey(providerId, key) {
      if (!cipher.isAvailable()) {
        // Same code/action/stage the single-key store used, so the renderer's existing handling of
        // `keychain_unavailable` keeps working unchanged.
        throw new UserFacingError(
          'Your OS keychain is unavailable, so Fixora will not store the key — it refuses to save a provider key in plain text.',
          {
            code: 'keychain_unavailable',
            action: { type: 'retry', label: 'Try again' },
            stage: 'keystore',
          },
        );
      }
      state.credentials[providerId] = { keyEnc: cipher.encrypt(key), hint: hintFor(key) };
      persist();
    },

    clearKey(providerId) {
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- keyed by provider id
      delete state.credentials[providerId];
      persist();
    },

    hasKey: (providerId) => state.credentials[providerId] !== undefined,

    hint: (providerId) => state.credentials[providerId]?.hint ?? null,

    getKey(providerId) {
      const stored = state.credentials[providerId];
      if (stored === undefined) return null;
      try {
        return cipher.decrypt(stored.keyEnc);
      } catch {
        // Ciphertext from another machine or another OS user. Unreadable is unconfigured, not a crash.
        return null;
      }
    },

    configured: () => Object.keys(state.credentials),
  };
}

/** The model stored by a v1 install, for the registry's own migration. Null when there was none. */
export function readLegacyModel(dir: string, fileName = LEGACY_CREDENTIALS_FILE): string | null {
  try {
    const legacy = JSON.parse(readFileSync(join(dir, fileName), 'utf8')) as LegacyFile;
    return typeof legacy.model === 'string' && legacy.model !== '' ? legacy.model : null;
  } catch {
    return null;
  }
}
