import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { type AiConfig, UNRESOLVED_MODEL } from '@fixora/shared-types';

/** The persisted half of AiConfig — everything this store actually owns. */
export type StoredAiConfig = Omit<AiConfig, 'capabilities' | 'suggestedModel'>;

/**
 * The v1 single-slot store, reduced to the one thing still live: the chosen model.
 *
 * It began as the BYOK KEY store — one encrypted credential in `userData/ai-credentials.json`, which
 * `ai:setKey` wrote and every provider was built from. Per-provider credentials replaced that
 * (`credentials/credential-store.ts`), and the key half here became not merely unused but actively
 * misleading: three separate bugs this cycle came from code reading this file and concluding the user
 * had configured nothing, while their real credential sat in the v2 store.
 *
 * So the credential half is gone — `setKey`, `clearKey`, `getKey`, `hasKey`, the ciphertext, the hint
 * and the cipher dependency. Nothing reads a key from here, and now nothing can.
 *
 * What remains is the legacy MODEL, and it remains for two reasons: `ai:setModel` is still live (the
 * "switch to a capable model" button), and `provider-registry.ts` reads this file on first run to
 * adopt an existing user's OpenRouter model into the registry. Deleting it would silently reset the
 * model for everyone upgrading, which is precisely the kind of breakage a beta should not ship.
 *
 * `configured` is retained on the returned shape because the wire type carries it, and is always
 * false here — `ai:getConfig` overrides it with the registry-derived answer, which is the only one
 * that has been true since credentials became per-provider.
 */

interface StoredModel {
  model: string;
}

export interface KeyStore {
  /**
   * What is STORED. Capabilities are deliberately absent: they are a property of the provider's
   * catalogue, not of this file, and this store must not pretend to know them. `ai:getConfig`
   * joins the two.
   */
  getConfig(): StoredAiConfig;
  setModel(model: string): StoredAiConfig;
}

export interface KeyStoreOptions {
  dir: string;
  fileName?: string;
}

export function createKeyStore(options: KeyStoreOptions): KeyStore {
  const file = join(options.dir, options.fileName ?? 'ai-credentials.json');

  const state: StoredModel = load();

  function load(): StoredModel {
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<StoredModel>;
      // Stored as-is. Whether the id still exists is the catalogue's call, made at resolve time —
      // this layer does not guess, and must never migrate on a read that never checked.
      return { model: typeof parsed.model === 'string' ? parsed.model : UNRESOLVED_MODEL };
    } catch {
      // Missing or corrupt — start clean. A corrupt file must never crash the app.
      return { model: UNRESOLVED_MODEL };
    }
  }

  /**
   * Rewrites the file with the model alone.
   *
   * Any `keyEnc`/`hint` a previous version left behind is therefore dropped the first time the model
   * changes. That is deliberate: the credential it held has been unreadable by this app since the key
   * half was removed, so keeping the ciphertext on disk would preserve a secret nothing can use.
   */
  function persist(): void {
    writeFileSync(file, JSON.stringify(state), { encoding: 'utf8', mode: 0o600 });
  }

  function config(): StoredAiConfig {
    return {
      // Always false. `ai:getConfig` replaces this with `anyProviderConfigured`, which asks the
      // registry — the only source that has been correct since keys became per-provider.
      configured: false,
      model: state.model,
      keyHint: null,
      migratedFrom: null,
    };
  }

  return {
    getConfig: config,

    setModel(model) {
      state.model = model;
      persist();
      return config();
    },
  };
}
