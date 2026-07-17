import { safeStorage } from 'electron';

/**
 * The encryption seam for at-rest secrets (Security §5). The BYOK key is encrypted with the OS
 * keychain (`safeStorage` → DPAPI on Windows, Keychain on macOS) before it ever touches disk, so a
 * copy of the file on its own is useless off the user's machine.
 *
 * It is an interface so the key store can be unit-tested with a fake — `safeStorage` needs the
 * Electron runtime and a logged-in OS user, neither of which exists under vitest.
 */
export interface SecretCipher {
  isAvailable(): boolean;
  /** Returns base64 ciphertext. */
  encrypt(plaintext: string): string;
  /** Takes base64 ciphertext. */
  decrypt(ciphertext: string): string;
}

export const safeStorageCipher: SecretCipher = {
  isAvailable: () => safeStorage.isEncryptionAvailable(),
  encrypt: (plaintext) => safeStorage.encryptString(plaintext).toString('base64'),
  decrypt: (ciphertext) => safeStorage.decryptString(Buffer.from(ciphertext, 'base64')),
};
