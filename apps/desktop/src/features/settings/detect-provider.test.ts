import { describe, expect, it } from 'vitest';

import { detectProvider } from './detect-provider.js';

/**
 * Key prefix detection.
 *
 * The ordering cases are the ones worth having: `sk-ant-` and `sk-or-` are both `sk-` keys, so a
 * naive rule set routes Anthropic and OpenRouter keys to OpenAI and the user gets a 401 from a
 * provider they never chose.
 */
describe('detectProvider', () => {
  it('Anthropic — sk-ant-', () => {
    expect(detectProvider('sk-ant-api03-abc123')).toEqual({ id: 'anthropic', label: 'Anthropic' });
  });

  it('OpenRouter — sk-or-', () => {
    expect(detectProvider('sk-or-v1-abc123')).toEqual({ id: 'openrouter', label: 'OpenRouter' });
  });

  it('Google Gemini — AIza', () => {
    expect(detectProvider('AIzaSyD-abc123')).toEqual({ id: 'gemini', label: 'Google Gemini' });
  });

  it('Groq — gsk_', () => {
    expect(detectProvider('gsk_abc123')).toEqual({ id: 'groq', label: 'Groq' });
  });

  it('OpenAI — sk-, only after the more specific sk- rules', () => {
    expect(detectProvider('sk-proj-abc123')).toEqual({ id: 'openai', label: 'OpenAI' });
  });

  it('an unknown key matches nothing rather than defaulting', () => {
    // Filing it under OpenAI would produce a 401 the user could not explain.
    expect(detectProvider('hf_abc123')).toBeNull();
    expect(detectProvider('random-text')).toBeNull();
    expect(detectProvider('')).toBeNull();
  });

  it('ORDER: an Anthropic key is never read as OpenAI', () => {
    expect(detectProvider('sk-ant-xyz')?.id).toBe('anthropic');
    expect(detectProvider('sk-ant-xyz')?.id).not.toBe('openai');
  });

  it('ORDER: an OpenRouter key is never read as OpenAI', () => {
    expect(detectProvider('sk-or-xyz')?.id).toBe('openrouter');
    expect(detectProvider('sk-or-xyz')?.id).not.toBe('openai');
  });

  it('tolerates the whitespace a copied key arrives with', () => {
    expect(detectProvider('  sk-ant-abc\n')?.id).toBe('anthropic');
    expect(detectProvider('\tgsk_abc ')?.id).toBe('groq');
  });

  it('is case-sensitive — these are literal vendor prefixes', () => {
    // `aiza…` is not a Google key; accepting it would file someone else's key under Gemini.
    expect(detectProvider('aizaSyD-abc')).toBeNull();
    expect(detectProvider('GSK_abc')).toBeNull();
  });
});
