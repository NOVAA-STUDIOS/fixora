/**
 * The entropy backstop for the secret gate (AI-Pipeline §2, layer 3).
 *
 * Known-format patterns (patterns.ts) catch the credentials we can name. This catches the ones we
 * can't: a random-looking, high-entropy token that no rule anticipated. It is deliberately tuned to
 * avoid the two common false positives that would erode trust in the gate:
 *
 *  - **Hex hashes** (git SHAs, sha256 digests). Pure hex maxes out at 4.0 bits/char, so a threshold
 *    above 4.0 excludes them structurally — a commit hash in the evidence must not block a repair.
 *  - **Ordinary identifiers and prose**, which sit well below the threshold.
 *
 * A random base64/mixed secret sits around 5–6 bits/char, comfortably above the line.
 */

const MIN_LENGTH = 20;
const ENTROPY_THRESHOLD = 4.2;
const TOKEN = /[A-Za-z0-9+/=_-]{20,}/g;

/** Shannon entropy in bits per character. */
export function shannonEntropy(value: string): number {
  if (value.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const char of value) counts.set(char, (counts.get(char) ?? 0) + 1);
  let entropy = 0;
  for (const count of counts.values()) {
    const p = count / value.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

function looksLikeSecret(token: string): boolean {
  if (token.length < MIN_LENGTH) return false;
  // Require a mix of letters and digits — pure words and pure numbers are not secrets.
  if (!/[A-Za-z]/.test(token) || !/[0-9]/.test(token)) return false;
  return shannonEntropy(token) >= ENTROPY_THRESHOLD;
}

/**
 * Returns true if the text contains at least one high-entropy token that looks like a secret. We
 * return a boolean, not the token — the gate must never carry the secret onto its result.
 */
export function hasHighEntropySecret(text: string): boolean {
  const matches = text.match(TOKEN);
  if (matches === null) return false;
  return matches.some(looksLikeSecret);
}
