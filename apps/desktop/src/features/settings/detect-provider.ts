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
export function detectProvider(key: string): DetectedProvider | null {
  const trimmed = key.trim();
  for (const rule of RULES) {
    if (trimmed.startsWith(rule.prefix)) return { id: rule.id, label: rule.label };
  }
  return null;
}
