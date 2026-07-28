import { SUGGESTION_MESSAGE_MAX_LENGTH, SUGGESTION_MESSAGE_MIN_LENGTH } from '@fixora/shared-types';
import { describe, expect, it } from 'vitest';

import { validateSuggestionInput } from '../electron/main/suggestions/suggestion-validator.js';

/**
 * The validator is pure and has no I/O, so every rule is testable at the boundary values directly —
 * no database, no service, no mocks. These pin the exact thresholds the service and the renderer
 * form both rely on staying in sync with.
 */
describe('validateSuggestionInput', () => {
  it('accepts a well-formed suggestion', () => {
    const result = validateSuggestionInput({ category: 'feature', message: 'Add dark mode please' });
    expect(result).toEqual({
      ok: true,
      value: { category: 'feature', message: 'Add dark mode please' },
    });
  });

  it('trims surrounding whitespace from the message', () => {
    const result = validateSuggestionInput({
      category: 'bug',
      message: '   there is a bug here   ',
    });
    expect(result.ok).toBe(true);
    expect(result.ok && result.value.message).toBe('there is a bug here');
  });

  it('rejects an unknown category', () => {
    const result = validateSuggestionInput({ category: 'nonsense', message: 'a valid message' });
    expect(result).toEqual({ ok: false, error: 'Choose a category for your suggestion.' });
  });

  it('rejects an empty message', () => {
    const result = validateSuggestionInput({ category: 'other', message: '' });
    expect(result.ok).toBe(false);
  });

  it('rejects a whitespace-only message as empty, not merely short', () => {
    const result = validateSuggestionInput({ category: 'other', message: '     ' });
    expect(result).toEqual({ ok: false, error: 'Write your suggestion before submitting.' });
  });

  it('rejects a message below the minimum length', () => {
    const message = 'x'.repeat(SUGGESTION_MESSAGE_MIN_LENGTH - 1);
    const result = validateSuggestionInput({ category: 'improvement', message });
    expect(result.ok).toBe(false);
    expect(result.ok || result.error).toContain('too short');
  });

  it('accepts a message at exactly the minimum length', () => {
    const message = 'x'.repeat(SUGGESTION_MESSAGE_MIN_LENGTH);
    const result = validateSuggestionInput({ category: 'improvement', message });
    expect(result.ok).toBe(true);
  });

  it('accepts a message at exactly the maximum length', () => {
    const message = 'x'.repeat(SUGGESTION_MESSAGE_MAX_LENGTH);
    const result = validateSuggestionInput({ category: 'improvement', message });
    expect(result.ok).toBe(true);
  });

  it('rejects a message above the maximum length', () => {
    const message = 'x'.repeat(SUGGESTION_MESSAGE_MAX_LENGTH + 1);
    const result = validateSuggestionInput({ category: 'improvement', message });
    expect(result.ok).toBe(false);
    expect(result.ok || result.error).toContain('too long');
  });

  it('trims before measuring length, so padding cannot smuggle a too-short message past validation', () => {
    const short = 'x'.repeat(SUGGESTION_MESSAGE_MIN_LENGTH - 1);
    const result = validateSuggestionInput({ category: 'other', message: `  ${short}  ` });
    expect(result.ok).toBe(false);
  });
});
