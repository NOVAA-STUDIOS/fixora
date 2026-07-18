/**
 * The Ed25519 public key that verifies Fixora licenses (SPKI DER, base64).
 *
 * EMPTY by default: the app ships with no signing authority until the owner provisions one. Run
 * `tooling/scripts/license-keygen.mjs`, keep the printed PRIVATE key OFFLINE (it signs licenses), and
 * paste the PUBLIC key here — or set `FIXORA_LICENSE_PUBLIC_KEY` (used for staging/tests). Until then
 * every install is simply Free, and `license:activate` reports "licensing not configured" rather than
 * pretending. This is the correct posture: the production signing key is never generated in the repo.
 */
const EMBEDDED_PUBLIC_KEY_DER_B64 = '';

export function licensePublicKey(): string {
  return process.env['FIXORA_LICENSE_PUBLIC_KEY'] ?? EMBEDDED_PUBLIC_KEY_DER_B64;
}
