import { describe, expect, it } from 'vitest';

import { isSecretPath } from '../electron/main/services/fs/secrets-denylist.js';

/**
 * The path-level secrets denylist (Security §4). A file that matches is never read into the app.
 * The dangerous failure is a false negative — a secret that slips through — so the denials are
 * tested explicitly and the allows are tested too, so the list is not so broad it hides source.
 */
describe('isSecretPath', () => {
  it.each([
    '.env',
    '.env.local',
    '.env.production',
    'config/.env',
    'id_rsa',
    'deploy/id_ed25519',
    '.ssh/known_hosts',
    'home/.ssh/config',
    '.aws/credentials',
    '.npmrc',
    'server.pem',
    'private.key',
    'cert.pfx',
    'app.keystore',
    'secrets.yaml',
    'secret.json',
    '.git/config',
  ])('denies %s', (p) => {
    expect(isSecretPath(p)).toBe(true);
  });

  it('denies regardless of path separator', () => {
    expect(isSecretPath('home\\.ssh\\id_rsa')).toBe(true);
    expect(isSecretPath('.\\.env')).toBe(true);
  });

  it.each([
    'src/index.ts',
    'README.md',
    'package.json',
    'env.d.ts', // not a dotenv file
    'keyboard.ts', // not a *.key
    'components/Key.tsx',
    'docs/secret-santa.md', // "secret-" is not "secret."
    '.gitignore',
  ])('allows %s', (p) => {
    expect(isSecretPath(p)).toBe(false);
  });
});
