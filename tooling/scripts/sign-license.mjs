// Mint a Fixora license after a Stripe purchase. Owner-run, offline.
//
//   FIXORA_LICENSE_PRIVATE_KEY_FILE=./fixora-license-private.pem \
//     node tooling/scripts/sign-license.mjs buyer@example.com [days]
//
// Prints one license key to send the buyer. `days` is optional (omit for a perpetual supporter
// license). The private key is read from the PEM file in the env var and never leaves this process.
import { createPrivateKey, randomUUID, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';

const [email, daysArg] = process.argv.slice(2);
if (email === undefined) {
  console.error('usage: sign-license.mjs <email> [days]');
  process.exit(1);
}

const keyFile = process.env['FIXORA_LICENSE_PRIVATE_KEY_FILE'];
if (keyFile === undefined) {
  console.error('set FIXORA_LICENSE_PRIVATE_KEY_FILE to your private-key PEM path');
  process.exit(1);
}

const privateKey = createPrivateKey(readFileSync(keyFile));
const now = Date.now();
const expiresAt = daysArg === undefined ? null : now + Number(daysArg) * 86_400_000;

const payload = {
  licenseId: randomUUID(),
  licensedTo: email,
  plan: 'pro',
  features: ['supporter'],
  issuedAt: now,
  expiresAt,
};

const payloadBytes = Buffer.from(JSON.stringify(payload), 'utf8');
const signature = sign(null, payloadBytes, privateKey);
const b64url = (b) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

console.log(`${b64url(payloadBytes)}.${b64url(signature)}`);
