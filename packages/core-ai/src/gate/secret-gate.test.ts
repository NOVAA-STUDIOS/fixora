import { describe, expect, it } from 'vitest';

import { gate, type GatePart } from './secret-gate.js';

const CLEAN_CODE = `
export function add(a: number, b: number): number {
  // Adds two numbers. Nothing secret here.
  return a + b;
}
`;

/**
 * The OpenRouter fixture, assembled at runtime rather than written out.
 *
 * A test for a secret DETECTOR has to contain something shaped like the secret, which makes this
 * file permanently interesting to every scanner that reads source text — GitHub push protection
 * rejected the repository over exactly this line, on a value that was never a real key (four
 * repetitions of `0123456789abcdef`).
 *
 * Joining the parts here keeps the scanner's view free of a contiguous `sk-or-v1-<48 hex>` literal
 * while `gate()` still receives the identical string, so the pattern
 * (`/\bsk-or-v1-[0-9a-f]{48,}\b/`) is exercised exactly as before. Writing a placeholder that does
 * NOT match the pattern would have been worse than useless: the test would only pass again if the
 * regex were loosened, and a loosened regex stops catching the real keys this gate exists to hold.
 */
const FAKE_OPENROUTER_KEY = ['sk', 'or', 'v1', '0123456789abcdef'.repeat(4)].join('-');

function part(text: string, label = 'src/example.ts'): GatePart[] {
  return [{ label, text }];
}

describe('secret gate — nothing leaves the machine without passing this', () => {
  it('passes a clean payload', () => {
    expect(gate(part(CLEAN_CODE))).toEqual({ ok: true });
  });

  // The smuggle test (AI-Pipeline §2): a live-looking credential of each shape must be blocked,
  // and the result must name the rule that fired. This is the merge-blocking acceptance control.
  const liveLookingSecrets: readonly (readonly [string, string, string])[] = [
    ['aws-access-key-id', 'const k = "AKIAIOSFODNN7EXAMPLE";', 'aws-access-key-id'],
    ['github classic token', 'token=ghp_012345678901234567890123456789abcdef', 'github-token'],
    [
      'github fine-grained pat',
      'GH=github_pat_11ABCDE0123456789_abcdefghijklmnopqrstuvwxyz0123',
      'github-fine-grained-pat',
    ],
    ['openai key', 'OPENAI_API_KEY=sk-abcdefghijklmnopqrstuvwxyz0123', 'openai-key'],
    ['anthropic key', 'k=sk-ant-api03-abcdefghijklmnopqrstuvwxyz', 'anthropic-key'],
    ['openrouter key', `k=${FAKE_OPENROUTER_KEY}`, 'openrouter-key'],
    ['google api key', 'key=AIzaSyA0123456789abcdefghijklmnopqrstuv', 'google-api-key'],
    ['stripe secret key', 'STRIPE=sk_live_0123456789abcdefABCDEF', 'stripe-secret-key'],
    ['jwt', 'auth=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTYifQ.abcDEF123_-xyz', 'jwt'],
    [
      'private key block',
      '-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA...\n-----END RSA PRIVATE KEY-----',
      'private-key',
    ],
    [
      'connection string with credentials',
      'DATABASE_URL=postgres://admin:s3cr3tp4ss@db.example.com:5432/app',
      'connection-string-credentials',
    ],
  ];

  it.each(liveLookingSecrets)('blocks a %s and names the rule', (_name, text, expectedRule) => {
    const result = gate(part(text));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.matches.some((m) => m.rule === expectedRule)).toBe(true);
    // The secret itself must never travel onto the result.
    expect(JSON.stringify(result)).not.toContain('AKIAIOSFODNN7EXAMPLE');
  });

  it('blocks a high-entropy token no named rule anticipated', () => {
    const result = gate(part('const token = "k3J8xQ2mZpL9vR4tW7yB1nD6fH0sA5cE8gU3iO2q";'));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.matches.some((m) => m.kind === 'entropy')).toBe(true);
  });

  it('blocks a payload part whose label is a denied path', () => {
    const result = gate([{ label: '.env', text: 'PORT=3000' }]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.matches[0]?.kind).toBe('path');
  });

  it('does NOT flag a git commit hash (hex maxes below the entropy line)', () => {
    // A 40-char sha in the evidence must not block a legitimate repair.
    const sha = '9f8e7d6c5b4a39281706f5e4d3c2b1a09f8e7d6c';
    expect(gate(part(`Fixed in commit ${sha}`, 'evidence:git')).ok).toBe(true);
  });

  it('scans every part, not just the first — a secret in the evidence is caught', () => {
    const parts: GatePart[] = [
      { label: 'src/ok.ts', text: CLEAN_CODE },
      { label: 'evidence:log', text: 'AWS_KEY=AKIAIOSFODNN7EXAMPLE' },
    ];
    const result = gate(parts);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.matches[0]?.label).toBe('evidence:log');
  });
});
