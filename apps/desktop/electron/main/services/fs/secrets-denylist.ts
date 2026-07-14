import { basename } from 'node:path';

/**
 * The path-level secrets denylist (Security §4, FR-5). These files are **never read into the app**
 * — not shown in the tree's preview, not opened in the editor's content channel, and (from M5)
 * never placed in a prompt. This is the coarse first layer; the content-scanning secret gate in
 * `core-ai` (M5) is the fine one. Defence in depth: a `.env` should be stopped by its *name* long
 * before any scanner has to look at its *bytes*.
 *
 * The list is matched against a workspace-relative POSIX path (forward slashes), so a directory
 * rule like `.ssh/` catches everything under it regardless of platform separators.
 */

/** Directory names whose entire subtree is off-limits, matched anywhere in the path. */
const DENIED_DIR_SEGMENTS = new Set(['.ssh', '.aws', '.gnupg']);

/** Exact filenames that are denied wherever they appear. */
const DENIED_FILENAMES = new Set([
  '.npmrc',
  '.netrc',
  'credentials',
  'id_rsa',
  'id_dsa',
  'id_ecdsa',
  'id_ed25519',
]);

/**
 * Filename patterns. Kept small and legible on purpose — a denylist nobody can read is a denylist
 * nobody maintains. `.git/config` is included because it can hold credential-embedded remote URLs.
 */
const DENIED_PATTERNS: readonly RegExp[] = [
  /^\.env($|\.)/i, // .env, .env.local, .env.production, …
  /\.pem$/i,
  /\.key$/i, // private keys (also *.pem)
  /\.pfx$/i,
  /\.p12$/i,
  /\.keystore$/i,
  /^secrets?\./i, // secret.json, secrets.yaml, …
];

/** Fixed relative paths that are denied (not just any file of that name). */
const DENIED_RELATIVE_PATHS = new Set(['.git/config']);

/**
 * Is this workspace-relative path a secret we refuse to read? `relPath` must use forward slashes
 * and must already be inside the workspace (the path guard's job — this function assumes it).
 */
export function isSecretPath(relPath: string): boolean {
  const normalized = relPath.replace(/\\/g, '/').replace(/^\.\//, '');

  if (DENIED_RELATIVE_PATHS.has(normalized)) return true;

  const segments = normalized.split('/');
  for (const segment of segments.slice(0, -1)) {
    if (DENIED_DIR_SEGMENTS.has(segment)) return true;
  }

  const name = basename(normalized);
  if (DENIED_FILENAMES.has(name)) return true;
  return DENIED_PATTERNS.some((pattern) => pattern.test(name));
}
