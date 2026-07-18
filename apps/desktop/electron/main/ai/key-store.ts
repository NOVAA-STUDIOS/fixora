import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { type AiConfig, UNRESOLVED_MODEL } from '@fixora/shared-types';

import type { SecretCipher } from './cipher.js';

/**
 * The BYOK key store (Security §5, ADR-016 spirit for keys). The provider key is encrypted with the
 * OS keychain and written to `userData/ai-credentials.json`; the plaintext exists only transiently in
 * this process when a provider call needs it, and it is **never** returned across IPC. The renderer
 * gets an `AiConfig` — configured, model, and a last-few-chars hint — and nothing more.
 *
 * The stored file holds the ciphertext, the non-sensitive hint, and the chosen model. If the file is
 * missing or unreadable we start unconfigured; a corrupt credentials file must never crash the app.
 */

interface StoredCredentials {
  keyEnc: string | null;
  hint: string | null;
  model: string;
}

function hintFor(key: string): string {
  const tail = key.slice(-4);
  return tail.length === 0 ? '••••' : `••••${tail}`;
}

export interface KeyStore {
  getConfig(): AiConfig;
  setKey(key: string, model?: string): AiConfig;
  clearKey(): AiConfig;
  setModel(model: string): AiConfig;
  hasKey(): boolean;
  /** Main-process only. Never expose this across IPC. */
  getKey(): string | null;
}

export interface KeyStoreOptions {
  dir: string;
  cipher: SecretCipher;
  fileName?: string;
}

export function createKeyStore(options: KeyStoreOptions): KeyStore {
  const file = join(options.dir, options.fileName ?? 'ai-credentials.json');
  const { cipher } = options;

  const state: StoredCredentials = load();

  function load(): StoredCredentials {
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<StoredCredentials>;
      return {
        keyEnc: typeof parsed.keyEnc === 'string' ? parsed.keyEnc : null,
        hint: typeof parsed.hint === 'string' ? parsed.hint : null,
        // Stored as-is. Whether the id still exists is the catalogue's call, made at resolve time —
        // this layer does not guess, and must never migrate on a read that never checked.
        model: typeof parsed.model === 'string' ? parsed.model : UNRESOLVED_MODEL,
      };
    } catch {
      // Missing or corrupt — start clean. Losing a stored key degrades to "paste it again", never a crash.
      return { keyEnc: null, hint: null, model: UNRESOLVED_MODEL };
    }
  }

  function persist(): void {
    writeFileSync(file, JSON.stringify(state), { encoding: 'utf8', mode: 0o600 });
  }

  function config(): AiConfig {
    return {
      configured: state.keyEnc !== null,
      model: state.model,
      keyHint: state.hint,
      migratedFrom: null,
    };
  }

  return {
    getConfig: config,

    setKey(key, model) {
      if (!cipher.isAvailable()) {
        // No OS keychain (rare: some Linux setups). We refuse to persist plaintext — the honest
        // failure is "encryption unavailable", surfaced as unconfigured, not a silent plaintext write.
        throw new Error('OS encryption is unavailable; cannot store the key securely.');
      }
      state.keyEnc = cipher.encrypt(key);
      state.hint = hintFor(key);
      if (model !== undefined) state.model = model;
      persist();
      return config();
    },

    clearKey() {
      state.keyEnc = null;
      state.hint = null;
      persist();
      return config();
    },

    setModel(model) {
      state.model = model;
      persist();
      return config();
    },

    hasKey: () => state.keyEnc !== null,

    getKey() {
      if (state.keyEnc === null) return null;
      try {
        return cipher.decrypt(state.keyEnc);
      } catch {
        return null;
      }
    },
  };
}
