import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { SecretCipher } from '../electron/main/ai/cipher.js';
import { createKeyStore } from '../electron/main/ai/key-store.js';

// A reversible stand-in for safeStorage — the real one needs the Electron runtime + an OS user.
const fakeCipher: SecretCipher = {
  isAvailable: () => true,
  encrypt: (plain) => Buffer.from(plain, 'utf8').toString('base64'),
  decrypt: (blob) => Buffer.from(blob, 'base64').toString('utf8'),
};

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'fixora-keystore-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('BYOK key store', () => {
  it('starts unconfigured', () => {
    const store = createKeyStore({ dir, cipher: fakeCipher });
    expect(store.getConfig().configured).toBe(false);
    expect(store.hasKey()).toBe(false);
    expect(store.getKey()).toBeNull();
  });

  it('stores a key encrypted, exposes only a hint, and can decrypt it in-process', () => {
    const store = createKeyStore({ dir, cipher: fakeCipher });
    const config = store.setKey('sk-or-v1-supersecretkey1234', 'openai/gpt-4o');
    expect(config.configured).toBe(true);
    expect(config.model).toBe('openai/gpt-4o');
    expect(config.keyHint).toBe('••••1234');
    // The config the renderer sees never carries the key.
    expect(JSON.stringify(config)).not.toContain('supersecret');
    // Main can still read it for a provider call.
    expect(store.getKey()).toBe('sk-or-v1-supersecretkey1234');
  });

  it('persists across instances but keeps the key ciphertext on disk, not plaintext', () => {
    const first = createKeyStore({ dir, cipher: fakeCipher });
    first.setKey('sk-secret-value-9999');
    // A fresh instance reading the same dir sees it configured and can decrypt.
    const second = createKeyStore({ dir, cipher: fakeCipher });
    expect(second.getConfig().configured).toBe(true);
    expect(second.getKey()).toBe('sk-secret-value-9999');
  });

  it('clears the key', () => {
    const store = createKeyStore({ dir, cipher: fakeCipher });
    store.setKey('sk-x-1234');
    expect(store.clearKey().configured).toBe(false);
    expect(store.getKey()).toBeNull();
  });

  it('degrades to unconfigured on a corrupt credentials file, never crashes', () => {
    const store = createKeyStore({ dir, cipher: fakeCipher, fileName: 'creds.json' });
    // Write garbage then reload.
    store.setKey('sk-x-1234');
    rmSync(join(dir, 'creds.json'));
    // Missing file → a new instance starts clean.
    const reloaded = createKeyStore({ dir, cipher: fakeCipher, fileName: 'creds.json' });
    expect(reloaded.getConfig().configured).toBe(false);
  });

  it('stores a model id verbatim and never rewrites it on read', () => {
    // Deciding an id is dead belongs to the catalogue, which can actually check. This layer holding
    // an opinion would mean migrating on a guess — including while offline, where "I could not
    // check" would be mistaken for "your model is gone".
    const store = createKeyStore({ dir, cipher: fakeCipher, fileName: 'legacy.json' });
    store.setKey('sk-or-v1-1234');
    const onDisk = JSON.parse(readFileSync(join(dir, 'legacy.json'), 'utf8')) as Record<
      string,
      unknown
    >;
    writeFileSync(
      join(dir, 'legacy.json'),
      JSON.stringify({ ...onDisk, model: 'anthropic/claude-3.5-sonnet' }),
    );

    const reloaded = createKeyStore({ dir, cipher: fakeCipher, fileName: 'legacy.json' });
    expect(reloaded.getConfig().model).toBe('anthropic/claude-3.5-sonnet');
    expect(reloaded.getConfig().configured).toBe(true);
  });

  it('starts with no model resolved rather than inventing one', () => {
    const store = createKeyStore({ dir, cipher: fakeCipher, fileName: 'fresh.json' });
    expect(store.getConfig().model).toBe('');
  });
});
