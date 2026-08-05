import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { isUserFacingError } from '@fixora/shared-types';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { SecretCipher } from '../electron/main/ai/cipher.js';
import {
  createCredentialStore,
  readLegacyModel,
} from '../electron/main/ai/credentials/credential-store.js';

/**
 * Per-provider secret storage.
 *
 * Two things are load-bearing and both are tested against the filesystem rather than a mock, because
 * both failures are silent: a key written in plaintext looks fine until someone reads the file, and a
 * migration that drops a key looks fine until an existing user opens the app and finds themselves
 * logged out of a provider they configured months ago.
 */

/** A reversible stand-in for `safeStorage`, which needs the Electron runtime and an OS user. */
function fakeCipher(available = true): SecretCipher {
  return {
    isAvailable: () => available,
    encrypt: (plaintext) => Buffer.from(`enc:${plaintext}`).toString('base64'),
    decrypt: (ciphertext) => {
      const decoded = Buffer.from(ciphertext, 'base64').toString('utf8');
      if (!decoded.startsWith('enc:')) throw new Error('not our ciphertext');
      return decoded.slice('enc:'.length);
    },
  };
}

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'fx-creds-'));
});
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe('credential store', () => {
  it('stores and returns a key per provider, independently', () => {
    const store = createCredentialStore({ dir, cipher: fakeCipher() });
    store.setKey('openrouter', 'sk-or-aaaa');
    store.setKey('openai', 'sk-oa-bbbb');

    expect(store.getKey('openrouter')).toBe('sk-or-aaaa');
    expect(store.getKey('openai')).toBe('sk-oa-bbbb');
    expect([...store.configured()].sort()).toEqual(['openai', 'openrouter']);
  });

  it('never writes a key in plaintext', () => {
    const store = createCredentialStore({ dir, cipher: fakeCipher() });
    store.setKey('openrouter', 'sk-or-SUPERSECRET');
    const raw = readFileSync(join(dir, 'ai-providers.json'), 'utf8');
    expect(raw).not.toContain('sk-or-SUPERSECRET');
    expect(raw).toContain('keyEnc');
  });

  /**
   * The refusal, unchanged from the single-key store. Falling back to plaintext would turn a
   * provider that will not turn on into a key sitting readable in the user's profile — which is
   * strictly worse, and invisible.
   */
  it('REFUSES to store anything when the OS keychain is unavailable', () => {
    const store = createCredentialStore({ dir, cipher: fakeCipher(false) });
    let thrown: unknown;
    try {
      store.setKey('openrouter', 'sk-or-aaaa');
    } catch (error) {
      thrown = error;
    }
    expect(isUserFacingError(thrown)).toBe(true);
    expect(store.hasKey('openrouter')).toBe(false);
  });

  it('exposes a masked hint and never the key itself', () => {
    const store = createCredentialStore({ dir, cipher: fakeCipher() });
    store.setKey('openrouter', 'sk-or-abcd1234');
    expect(store.hint('openrouter')).toBe('••••1234');
    expect(store.hint('openrouter')).not.toContain('sk-or');
    expect(store.hint('openai')).toBeNull();
  });

  it('clearing one provider leaves the others alone', () => {
    const store = createCredentialStore({ dir, cipher: fakeCipher() });
    store.setKey('openrouter', 'a');
    store.setKey('openai', 'b');
    store.clearKey('openrouter');
    expect(store.hasKey('openrouter')).toBe(false);
    expect(store.getKey('openai')).toBe('b');
  });

  it('persists across instances', () => {
    createCredentialStore({ dir, cipher: fakeCipher() }).setKey('openai', 'sk-oa-1');
    expect(createCredentialStore({ dir, cipher: fakeCipher() }).getKey('openai')).toBe('sk-oa-1');
  });

  it('ciphertext it cannot decrypt reads as unconfigured, not as a crash', () => {
    // Another machine, or another OS user: `safeStorage` will refuse it.
    writeFileSync(
      join(dir, 'ai-providers.json'),
      JSON.stringify({ version: 2, credentials: { openai: { keyEnc: 'garbage', hint: '••••' } } }),
    );
    const store = createCredentialStore({ dir, cipher: fakeCipher() });
    expect(store.getKey('openai')).toBeNull();
    // The entry still exists, so the UI can say "re-enter your key" rather than silently forgetting.
    expect(store.hasKey('openai')).toBe(true);
  });

  it('one corrupt entry does not take the others down with it', () => {
    writeFileSync(
      join(dir, 'ai-providers.json'),
      JSON.stringify({
        version: 2,
        credentials: {
          broken: { hint: 'no keyEnc' },
          openai: { keyEnc: Buffer.from('enc:good').toString('base64'), hint: '••••' },
        },
      }),
    );
    const store = createCredentialStore({ dir, cipher: fakeCipher() });
    expect(store.configured()).toEqual(['openai']);
    expect(store.getKey('openai')).toBe('good');
  });

  it('a missing or corrupt file starts clean rather than crashing', () => {
    writeFileSync(join(dir, 'ai-providers.json'), 'not json at all');
    expect(createCredentialStore({ dir, cipher: fakeCipher() }).configured()).toEqual([]);
  });
});

/**
 * BACKWARD COMPATIBILITY — the contract for every existing user.
 *
 * They configured OpenRouter once and have not thought about it since. An upgrade that asks them to
 * paste their key again is a failure of this sprint, no matter how good the architecture underneath.
 */
describe('migration from the v1 single-key file', () => {
  function writeLegacy(model = 'anthropic/claude-3.5-sonnet'): void {
    writeFileSync(
      join(dir, 'ai-credentials.json'),
      JSON.stringify({
        keyEnc: Buffer.from('enc:sk-or-legacy').toString('base64'),
        hint: '••••gacy',
        model,
      }),
    );
  }

  it('an existing OpenRouter user keeps their key with no action', () => {
    writeLegacy();
    const store = createCredentialStore({ dir, cipher: fakeCipher() });
    expect(store.hasKey('openrouter')).toBe(true);
    expect(store.getKey('openrouter')).toBe('sk-or-legacy');
    expect(store.hint('openrouter')).toBe('••••gacy');
  });

  it('their model survives too, for the registry to adopt', () => {
    writeLegacy('openai/gpt-oss-20b:free');
    expect(readLegacyModel(dir)).toBe('openai/gpt-oss-20b:free');
  });

  /**
   * The ciphertext is copied verbatim rather than re-encrypted. It came from the same `safeStorage`
   * on the same machine, so it decrypts unchanged — and re-encrypting would mean holding the
   * plaintext to do it. Copying bytes we never decrypt is both simpler and safer.
   */
  it('copies the ciphertext without ever decrypting it', () => {
    writeLegacy();
    const before = (JSON.parse(readFileSync(join(dir, 'ai-credentials.json'), 'utf8')) as {
      keyEnc: string;
    }).keyEnc;
    createCredentialStore({ dir, cipher: fakeCipher() }).setKey('openai', 'x'); // force a persist
    const after = (JSON.parse(readFileSync(join(dir, 'ai-providers.json'), 'utf8')) as {
      credentials: Record<string, { keyEnc: string }>;
    }).credentials['openrouter']?.keyEnc;
    expect(after).toBe(before);
  });

  it('leaves the v1 file in place, so a downgrade still finds the key', () => {
    writeLegacy();
    createCredentialStore({ dir, cipher: fakeCipher() });
    expect(() => readFileSync(join(dir, 'ai-credentials.json'), 'utf8')).not.toThrow();
  });

  it('a v1 file with no key migrates to nothing rather than to a broken entry', () => {
    writeFileSync(join(dir, 'ai-credentials.json'), JSON.stringify({ keyEnc: null, model: 'm' }));
    expect(createCredentialStore({ dir, cipher: fakeCipher() }).configured()).toEqual([]);
  });

  it('does not re-migrate once the v2 file exists', () => {
    writeLegacy();
    const first = createCredentialStore({ dir, cipher: fakeCipher() });
    first.clearKey('openrouter'); // the user deliberately removed it
    // A second load must respect that, not resurrect the key from the legacy file.
    expect(createCredentialStore({ dir, cipher: fakeCipher() }).hasKey('openrouter')).toBe(false);
  });

  it('a fresh install with no files at all is simply unconfigured', () => {
    const store = createCredentialStore({ dir, cipher: fakeCipher() });
    expect(store.configured()).toEqual([]);
    expect(readLegacyModel(dir)).toBeNull();
  });
});
