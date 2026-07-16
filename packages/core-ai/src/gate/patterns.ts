/**
 * Known-format secret patterns for the content-scan layer of the gate (AI-Pipeline §2).
 *
 * These match the *shape* of well-known credentials — provider keys, cloud keys, tokens, private
 * keys, credentialed connection strings. A match is a hard block. The matched text is never stored
 * on the result or logged: we report the rule that fired and the payload part it fired in, never the
 * secret itself.
 *
 * This list is intentionally legible over exhaustive — the entropy heuristic (see entropy.ts) is the
 * backstop for shapes we don't enumerate. A denylist nobody can read is a denylist nobody maintains.
 */

export interface SecretPattern {
  /** Stable, human-readable id shown to the user: "which rule matched". */
  readonly id: string;
  readonly regex: RegExp;
}

export const SECRET_PATTERNS: readonly SecretPattern[] = [
  // Private key material — the highest-severity, lowest-false-positive signal there is.
  { id: 'private-key', regex: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/ },

  // Cloud + platform keys.
  { id: 'aws-access-key-id', regex: /\bAKIA[0-9A-Z]{16}\b/ },
  { id: 'google-api-key', regex: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { id: 'slack-token', regex: /\bxox[baprs]-[0-9A-Za-z-]{10,}\b/ },
  { id: 'slack-webhook', regex: /https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/]+/ },

  // GitHub tokens (classic + fine-grained).
  { id: 'github-token', regex: /\bgh[posru]_[0-9A-Za-z]{36,}\b/ },
  { id: 'github-fine-grained-pat', regex: /\bgithub_pat_[0-9A-Za-z_]{22,}\b/ },

  // AI/LLM provider keys — the ones a BYOK user will actually paste around.
  { id: 'anthropic-key', regex: /\bsk-ant-[0-9A-Za-z_-]{20,}\b/ },
  { id: 'openrouter-key', regex: /\bsk-or-v1-[0-9a-f]{48,}\b/ },
  // OpenAI classic + project keys. Kept after the more specific sk- rules above.
  { id: 'openai-key', regex: /\bsk-(?:proj-)?[0-9A-Za-z_-]{20,}\b/ },

  // Payment + auth tokens.
  { id: 'stripe-secret-key', regex: /\b[rs]k_live_[0-9A-Za-z]{16,}\b/ },
  { id: 'jwt', regex: /\beyJ[0-9A-Za-z_-]+\.[0-9A-Za-z_-]+\.[0-9A-Za-z_-]+\b/ },

  // Credentials embedded in a connection string: scheme://user:password@host
  {
    id: 'connection-string-credentials',
    regex: /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqps?):\/\/[^\s:@/]+:[^\s:@/]+@/i,
  },
];
