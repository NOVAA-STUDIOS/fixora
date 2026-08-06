/**
 * Which provider issued this API key, read from its prefix.
 *
 * Every vendor stamps its keys, so a user who has just copied one from a dashboard should not also
 * have to find the matching row before they can paste it. The primary field takes any key and files
 * it in the right slot.
 *
 * ORDER MATTERS, and two of these rules only work because of it. `sk-ant-` and `sk-or-` are both
 * `sk-` keys, so OpenAI's plain `sk-` must be tested LAST or it would claim Anthropic's and
 * OpenRouter's keys and route the user's request to a provider that will reject it.
 *
 * Detection is a convenience, never an authority: the key still goes to the provider's own slot and
 * is still validated by that provider on the first request. A wrong guess costs one clear 401, which
 * is why an unrecognised prefix refuses rather than picking a default — silently filing an unknown
 * key under OpenAI would produce exactly that 401 with no explanation of where it came from.
 */
export interface DetectedProvider {
  /** Provider id, matching the registry and the credential store. */
  readonly id: string;
  /** Human name, for the confirmation shown under the field. */
  readonly label: string;
}

/** Prefix → provider, in the order they must be tested. */
const RULES: readonly (DetectedProvider & { prefix: string })[] = [
  { prefix: 'sk-ant-', id: 'anthropic', label: 'Anthropic' },
  { prefix: 'sk-or-', id: 'openrouter', label: 'OpenRouter' },
  { prefix: 'AIza', id: 'gemini', label: 'Google Gemini' },
  { prefix: 'gsk_', id: 'groq', label: 'Groq' },
  // Last: every rule above is also an `sk-` key for some vendor.
  { prefix: 'sk-', id: 'openai', label: 'OpenAI' },
];

/**
 * The provider a key belongs to, or null when nothing recognises it.
 *
 * Whitespace is trimmed because a key copied from a dashboard routinely arrives with a trailing
 * newline, and refusing that would be a puzzle rather than a safeguard. Case is significant — these
 * are literal prefixes the vendors issue, and matching loosely would accept keys that are not theirs.
 */
/**
 * Everything a pasted key can arrive wrapped in.
 *
 * `trim()` removes whitespace, and nothing else. A key copied out of a provider dashboard, a docs
 * page or a chat message routinely carries a zero-width space, a BOM, or a word-joiner in front of
 * it — invisible characters that survive `trim()` and break `startsWith` for EVERY prefix at once.
 * That is the signature of "all five providers report unknown": not a broken pattern, one unseen
 * character ahead of the text.
 *
 * Surrounding quotes and backticks go too, because the other common way to copy a key is out of a
 * code sample where it was already a string literal.
 */
// Matching control characters is the POINT here: a key pasted from a terminal or a mangled
// clipboard can carry NUL or an escape byte. The rule exists to catch people who wrote one by
// accident, which is the opposite of this.
// eslint-disable-next-line no-control-regex
const INVISIBLE = /[\u200B-\u200D\uFEFF\u2060\u00AD\u0000-\u001F\u007F]/gu;

/** Strip what a paste can carry so the prefix is the first thing left. Exported for tests. */
export function normaliseKey(key: string): string {
  return key.replace(INVISIBLE, '').trim().replace(/^["'`]+|["'`]+$/g, '').trim();
}

export function detectProvider(key: string): DetectedProvider | null {
  const trimmed = normaliseKey(key);
  for (const rule of RULES) {
    if (trimmed.startsWith(rule.prefix)) return { id: rule.id, label: rule.label };
  }
  return null;
}
