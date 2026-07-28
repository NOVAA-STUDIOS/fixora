/**
 * Builds a `mailto:` URL from `{ to, subject, body }` using only the `URL`/`URLSearchParams` APIs —
 * never manual template-literal concatenation of the query string. Both the recipient and the
 * generated URL are validated by the caller (`MailService`) before and after this runs; this
 * function's only job is correct encoding.
 *
 * One deliberate correction on top of `URLSearchParams`: it serializes per
 * `application/x-www-form-urlencoded`, which encodes a space as a literal `+`. RFC 6068 (the mailto
 * URI spec) expects RFC 3986 percent-encoding, where space is `%20` and `+` is a literal plus sign —
 * a strict mail client reading a raw `+` in a `mailto:` body would show a literal "+", not a space.
 * `URLSearchParams` itself already escapes any *literal* `+` in the input to `%2B` (so `+` never
 * collides with `x+y@example.com` semantics), which means every remaining `+` in the built query
 * string is one `URLSearchParams` produced to represent a space, and swapping it for `%20` is exact,
 * not a guess. This is the one narrow, documented exception to "always use the URL APIs verbatim" —
 * it corrects a specific, known mismatch between two encoding standards, not a hand-rolled encoder.
 */

export type MailtoInput = {
  to: string;
  subject: string;
  body: string;
};

export function buildMailtoUrl({ to, subject, body }: MailtoInput): string {
  const url = new URL(`mailto:${to}`);
  url.searchParams.set('subject', subject);
  url.searchParams.set('body', body);
  const search = url.search.replace(/\+/g, '%20');
  return `${url.protocol}${url.pathname}${search}`;
}
