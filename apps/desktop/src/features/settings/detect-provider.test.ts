import { describe, expect, it } from 'vitest';

import { detectProvider, normaliseKey } from './detect-provider.js';

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

/**
 * What a paste actually carries.
 *
 * `trim()` removes whitespace and nothing else, so one zero-width space in front of a key breaks
 * `startsWith` for EVERY prefix at once — which is exactly what "all five providers report unknown"
 * looks like from the outside. These pin the normalisation, one case per way a key arrives dirty.
 */
describe('normaliseKey — a key survives how it was copied', () => {
  it('strips a leading zero-width space, which trim() leaves behind', () => {
    expect(detectProvider('\u200Bsk-or-v1-abc')?.id).toBe('openrouter');
  });

  it('strips a BOM, the usual souvenir of a copy out of a web page', () => {
    expect(detectProvider('\uFEFFsk-ant-api03-x')?.id).toBe('anthropic');
  });

  it('strips a soft hyphen and a word joiner', () => {
    expect(detectProvider('\u00ADAIzaSyD-x')?.id).toBe('gemini');
    expect(detectProvider('\u2060gsk_x')?.id).toBe('groq');
  });

  it('strips control characters that are not whitespace', () => {
    expect(detectProvider('\u0000sk-proj-x')?.id).toBe('openai');
  });

  it('strips surrounding quotes — the other way keys get copied', () => {
    expect(detectProvider('"sk-or-v1-abc"')?.id).toBe('openrouter');
    expect(detectProvider("'gsk_x'")?.id).toBe('groq');
    expect(detectProvider('`AIzaSyD-x`')?.id).toBe('gemini');
  });

  it('leaves a clean key untouched', () => {
    expect(normaliseKey('sk-or-v1-abc')).toBe('sk-or-v1-abc');
  });

  it('still refuses a genuinely unknown key after normalising', () => {
    // Hardening must not turn into "accept anything" — an unrecognised prefix is still unknown.
    expect(detectProvider('\u200B"hf_abc"')).toBeNull();
  });
});
