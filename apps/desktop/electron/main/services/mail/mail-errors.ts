/**
 * `MailUnavailableError` is the one, specific, anticipated business outcome of `sendMail`: no
 * handler is registered, or `shell.openExternal` failed. Callers (the `suggestions:share` handler)
 * catch this one type to produce the "no mail app" UI outcome, and let anything else — a validation
 * failure, a programmer error — propagate as a genuine, unexpected error instead.
 */
export class MailUnavailableError extends Error {
  override readonly name = 'MailUnavailableError';
}

/**
 * `GmailFallbackError` is the equivalent anticipated outcome for `openGmailFallback`: the browser
 * could not be launched. Kept as its own class (not a reused `MailUnavailableError`) because the two
 * produce different user-facing text — the mailto failure explains "no mail app configured"; this
 * one explains "Gmail specifically couldn't open" — and callers need to tell them apart.
 */
export class GmailFallbackError extends Error {
  override readonly name = 'GmailFallbackError';
}
