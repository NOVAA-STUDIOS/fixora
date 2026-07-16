import { basename } from 'node:path';

/**
 * The path denylist layer of the gate (AI-Pipeline §2, layer 1).
 *
 * The desktop already refuses to *read* these files (fs/secrets-denylist). This is the same list,
 * re-asserted at the gate as defence in depth: a `.env` must be stopped by its name long before any
 * scanner looks at its bytes, and the gate is the last thing standing between a payload and a
 * provider. Matched against a workspace-relative POSIX path.
 */

const DENIED_DIR_SEGMENTS = new Set(['.ssh', '.aws', '.gnupg']);

const DENIED_FILENAMES = new Set([
  '.npmrc',
  '.netrc',
  'credentials',
  'id_rsa',
  'id_dsa',
  'id_ecdsa',
  'id_ed25519',
]);

const DENIED_PATTERNS: readonly RegExp[] = [
  /^\.env($|\.)/i,
  /\.pem$/i,
  /\.key$/i,
  /\.pfx$/i,
  /\.p12$/i,
  /\.keystore$/i,
  /^secrets?\./i,
];

const DENIED_RELATIVE_PATHS = new Set(['.git/config']);

export function isDeniedPath(label: string): boolean {
  const normalized = label.replace(/\\/g, '/').replace(/^\.\//, '');
  if (DENIED_RELATIVE_PATHS.has(normalized)) return true;

  const segments = normalized.split('/');
  for (const segment of segments.slice(0, -1)) {
    if (DENIED_DIR_SEGMENTS.has(segment)) return true;
  }

  const name = basename(normalized);
  if (DENIED_FILENAMES.has(name)) return true;
  return DENIED_PATTERNS.some((pattern) => pattern.test(name));
}
