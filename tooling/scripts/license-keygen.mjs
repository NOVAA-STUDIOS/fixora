// One-time key generation for Fixora licensing. Run: node tooling/scripts/license-keygen.mjs
//
// Ed25519. The PUBLIC key goes into the app (electron/main/license/public-key.ts, or the
// FIXORA_LICENSE_PUBLIC_KEY env var). The PRIVATE key signs licenses and must stay OFFLINE — save it
// somewhere safe (a password manager), never commit it, never put it in the app. There is no way to
// recover it; regenerating means invalidating every license already issued.
import { generateKeyPairSync } from 'node:crypto';

const { publicKey, privateKey } = generateKeyPairSync('ed25519');

const publicDerB64 = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' });

console.log('=== PUBLIC KEY (embed in the app: EMBEDDED_PUBLIC_KEY_DER_B64) ===');
console.log(publicDerB64);
console.log('\n=== PRIVATE KEY (KEEP OFFLINE — signs licenses, never commit) ===');
console.log(privatePem.trimEnd());
