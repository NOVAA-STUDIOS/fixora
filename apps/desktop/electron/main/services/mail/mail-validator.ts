/**
 * Pure validation for the three pieces of a mailto email — no I/O, no Electron, testable in
 * isolation. `MailService` refuses to build a `mailto:` URL from anything that fails here, so an
 * invalid URL is never handed to `shell.openExternal` in the first place.
 */

export type MailValidationResult = { ok: true } | { ok: false; error: string };

// Deliberately permissive (not a full RFC 5322 parser — nothing is): the goal is to catch obvious
// garbage ("", "not an email", a scheme string), not to be the last word on what a valid email
// address is. `to` is normally our own fixed constant, never user input, but the check exists
// because a reusable service must not trust its callers either.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// A generous but real cap. Some mail clients / OS URL-length limits (historically ~2000 chars on
// older Windows shells) truncate a mailto: URL well before this; that is a platform limitation
// (documented in docs/features/mail-service.md), not something validation can fix — this cap only
// catches a runaway/absurd value before it reaches the OS at all.
export const MAX_SUBJECT_LENGTH = 998; // RFC 5322 §2.1.1 practical header line length
export const MAX_BODY_LENGTH = 8000;

export function validateRecipient(to: string): MailValidationResult {
  if (to.trim().length === 0) return { ok: false, error: 'Recipient is required.' };
  if (!EMAIL_RE.test(to)) return { ok: false, error: 'Recipient is not a valid email address.' };
  return { ok: true };
}

export function validateSubject(subject: string): MailValidationResult {
  if (subject.trim().length === 0) return { ok: false, error: 'Subject is required.' };
  if (subject.length > MAX_SUBJECT_LENGTH) {
    return { ok: false, error: `Subject is too long (max ${String(MAX_SUBJECT_LENGTH)} characters).` };
  }
  // A line break in a mail header is a classic header-injection vector (a naive mail client could
  // read text after the break as a new header). The body allows line breaks; the subject never does.
  if (/[\r\n]/.test(subject)) return { ok: false, error: 'Subject cannot contain line breaks.' };
  return { ok: true };
}

export function validateBody(body: string): MailValidationResult {
  if (body.length > MAX_BODY_LENGTH) {
    return { ok: false, error: `Body is too long (max ${String(MAX_BODY_LENGTH)} characters).` };
  }
  return { ok: true };
}

export function validateMail(input: {
  to: string;
  subject: string;
  body: string;
}): MailValidationResult {
  const recipient = validateRecipient(input.to);
  if (!recipient.ok) return recipient;
  const subject = validateSubject(input.subject);
  if (!subject.ok) return subject;
  return validateBody(input.body);
}
