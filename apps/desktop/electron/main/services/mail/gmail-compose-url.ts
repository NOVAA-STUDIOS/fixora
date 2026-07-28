/**
 * Builds a Gmail web Compose URL from `{ to, subject, body }`, using only the `URL`/`URLSearchParams`
 * APIs — never manual template-literal concatenation of the query string.
 *
 * Unlike `mailto-url.ts`, this needs **no** space-encoding correction: this is a normal `https:`
 * URL, and a standard query string's `application/x-www-form-urlencoded` serialization (space as
 * `+`) is exactly what browsers and web servers — including Gmail's own compose page — expect for a
 * query parameter. The RFC 6068 mismatch that `mailto-url.ts` corrects for is specific to the
 * `mailto:` scheme; it does not apply here, so `URLSearchParams.toString()` is used completely
 * as-is.
 */

export type GmailComposeInput = {
  to: string;
  subject: string;
  body: string;
};

const GMAIL_COMPOSE_BASE = 'https://mail.google.com/mail/?view=cm&fs=1';

export function buildGmailComposeUrl({ to, subject, body }: GmailComposeInput): string {
  const url = new URL(GMAIL_COMPOSE_BASE);
  url.searchParams.set('to', to);
  url.searchParams.set('su', subject);
  url.searchParams.set('body', body);
  return url.toString();
}
