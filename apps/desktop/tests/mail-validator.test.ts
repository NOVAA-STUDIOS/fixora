import { describe, expect, it } from 'vitest';

import {
  MAX_BODY_LENGTH,
  MAX_SUBJECT_LENGTH,
  validateBody,
  validateMail,
  validateRecipient,
  validateSubject,
} from '../electron/main/services/mail/mail-validator.js';

describe('validateRecipient', () => {
  it('accepts a well-formed email address', () => {
    expect(validateRecipient('novaa.support.team@gmail.com')).toEqual({ ok: true });
  });

  it('rejects an empty recipient', () => {
    expect(validateRecipient('')).toEqual({ ok: false, error: 'Recipient is required.' });
  });

  it('rejects a whitespace-only recipient', () => {
    expect(validateRecipient('   ').ok).toBe(false);
  });

  it('rejects a string with no @', () => {
    expect(validateRecipient('not-an-email').ok).toBe(false);
  });

  it('rejects a string with no domain dot', () => {
    expect(validateRecipient('user@localhost').ok).toBe(false);
  });

  it('rejects an address containing whitespace', () => {
    expect(validateRecipient('user name@example.com').ok).toBe(false);
  });
});

describe('validateSubject', () => {
  it('accepts a normal subject', () => {
    expect(validateSubject('Fixora Suggestion - Feature request')).toEqual({ ok: true });
  });

  it('rejects an empty subject', () => {
    expect(validateSubject('').ok).toBe(false);
  });

  it('accepts a subject at exactly the maximum length', () => {
    expect(validateSubject('x'.repeat(MAX_SUBJECT_LENGTH)).ok).toBe(true);
  });

  it('rejects a subject over the maximum length (long subject)', () => {
    const result = validateSubject('x'.repeat(MAX_SUBJECT_LENGTH + 1));
    expect(result.ok).toBe(false);
    expect(result.ok || result.error).toContain('too long');
  });

  it('rejects a subject containing a line break (header-injection guard)', () => {
    expect(validateSubject('Subject\nX-Injected: evil').ok).toBe(false);
    expect(validateSubject('Subject\r\nX-Injected: evil').ok).toBe(false);
  });

  it('accepts unicode and emoji in the subject', () => {
    expect(validateSubject('Café ☕ suggestion 🎉').ok).toBe(true);
  });
});

describe('validateBody', () => {
  it('accepts a normal multi-line body', () => {
    expect(validateBody('Line one\nLine two')).toEqual({ ok: true });
  });

  it('accepts an empty body (a suggestion body is never actually empty in practice, but the validator does not assume that)', () => {
    expect(validateBody('').ok).toBe(true);
  });

  it('accepts a body at exactly the maximum length', () => {
    expect(validateBody('x'.repeat(MAX_BODY_LENGTH)).ok).toBe(true);
  });

  it('rejects a body over the maximum length (long body)', () => {
    const result = validateBody('x'.repeat(MAX_BODY_LENGTH + 1));
    expect(result.ok).toBe(false);
    expect(result.ok || result.error).toContain('too long');
  });

  it('accepts unicode, emoji, and special characters in the body', () => {
    expect(validateBody('Special chars: & = ? % + café 🎉\nSecond line').ok).toBe(true);
  });
});

describe('validateMail', () => {
  it('accepts a fully valid input', () => {
    expect(
      validateMail({ to: 'a@b.com', subject: 'Hi', body: 'Hello there' }),
    ).toEqual({ ok: true });
  });

  it('reports the recipient error first when multiple fields are invalid', () => {
    const result = validateMail({ to: '', subject: '', body: '' });
    expect(result).toEqual({ ok: false, error: 'Recipient is required.' });
  });
});
