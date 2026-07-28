# MailService (Sprint F1.4, F1.5)

The one, reusable way anything in Fixora opens a `mailto:` link — or, since Sprint F1.5, falls back
to Gmail's web compose UI when it can't. Built after BUG-F1-EMAIL-001 — "Email to Fixora" clicking
and doing nothing, with no error — proved that a rejection-only fix (await `shell.openExternal`,
catch, throw) was not enough: real, non-mocked runtime tracing showed `shell.openExternal` can
**resolve** for a `mailto:` URL even when nothing on the machine can handle it. `MailService` closes
that gap by checking, per platform, whether a handler is even registered *before* ever calling
`shell.openExternal` — and now, when there genuinely is none, offers a one-click way out instead of
leaving the user stuck.

Currently used by the Suggestion System's **Email to Fixora** (the only caller today). Any future
feature that needs to send mail takes a `MailService` dependency the same way — there is exactly one
implementation, and nothing else in the codebase is allowed to call `shell.openExternal` with a
`mailto:` or Gmail-compose URL directly.

## Where it lives

```
apps/desktop/electron/main/services/mail/
  mail-validator.ts           pure: validateRecipient/Subject/Body/Mail — no I/O, shared by both paths
  mailto-url.ts                pure: buildMailtoUrl — URL/URLSearchParams only, RFC 6068 space fix
  gmail-compose-url.ts         pure: buildGmailComposeUrl — URL/URLSearchParams only (F1.5)
  mail-handler-detection.ts    per-platform "is anything registered for mailto:" checks
  mail-errors.ts                MailUnavailableError (mailto) + GmailFallbackError (F1.5)
  mail-service.ts               orchestration for both sendMail and openGmailFallback

apps/desktop/electron/main/ipc/handlers/suggestions.handlers.ts
                                 the one caller today; owns the recipient constant (MailService itself
                                 has none — fully generic, `to` is always a parameter)
apps/desktop/src/features/suggestions/
  mail-unavailable-dialog.tsx   the "no mail client" UI (F1.4): Open Gmail, Copy Email Address,
                                 Copy Subject, Copy Message, Cancel (F1.5 added Open Gmail + Copy Message)
```

## Supported platforms

| Platform | Detection method | Reliability |
| --- | --- | --- |
| Windows | `reg query HKCR\mailto\shell\open\command` | Exact — a real registry lookup |
| macOS | `defaults read .../launchservices.secure LSHandlers`, parsed for a `mailto` entry with a real bundle id | Heuristic — undocumented Apple plist format |
| Linux | `xdg-mime query default x-scheme-handler/mailto`, falling back to `which xdg-email` | Heuristic — no single registry; the fallback is a weaker "tooling exists" signal |
| Anything else | No check performed | Falls through to `shell.openExternal`'s own resolve/reject (pre-F1.4 behaviour) |

## Gmail web fallback (Sprint F1.5)

### Why it exists

Even with per-platform handler detection (F1.4), a real, non-hypothetical case remains: the user
genuinely has no mail application configured at all — a fresh machine, a minimal Linux install, a
dev VM. `MailUnavailableDialog`'s Copy Email/Subject actions solved "the user can still get the
content out," but still left them composing and sending the email entirely by hand. Gmail is the
single most widely-held email account type, and its web UI accepts a pre-filled compose link the
same way a `mailto:` link does — so offering it closes the gap for the common case with one click,
without requiring any local mail client at all.

### When it is used

Only ever offered from `MailUnavailableDialog` — i.e. only after `suggestions:share` has already
reported `no_mail_client`. It is never attempted automatically and never attempted first; the local
mail client is always tried before Gmail is even offered as an option, and the user must explicitly
click **Open Gmail**.

### How it works

`buildGmailComposeUrl({ to, subject, body })` (`gmail-compose-url.ts`) builds
`https://mail.google.com/mail/?view=cm&fs=1&to=...&su=...&body=...` using only
`URL`/`URLSearchParams` — the same "no manual concatenation" discipline as `mailto-url.ts`, but
**without** that file's RFC 6068 space-encoding correction: this is an ordinary `https:` URL, and a
standard query string's `application/x-www-form-urlencoded` serialization (space as `+`) is exactly
what a normal web URL — including Gmail's own compose page — expects. Applying the mailto-specific
fix here would be wrong, not merely unnecessary.

`MailService.openGmailFallback` validates the same `{ to, subject, body }` shape `sendMail` does
(shared `validateMail`), builds the URL, asserts it is really `https://mail.google.com/…` (see
Security, below), and calls `shell.openExternal`. Unlike `sendMail`, it does **not** run a
platform handler-detection pass first — a default web browser is present on essentially every real
desktop, and no such check was requested; it relies on `shell.openExternal`'s own resolve/reject,
the same way `sendMail` did before BUG-F1-EMAIL-001's fix existed for mailto. This is a deliberate,
documented simplification, not an oversight.

### Browser requirements

Any browser capable of opening `https://mail.google.com/mail/?view=cm&fs=1&...` and rendering
Gmail's own compose UI works — there is no Fixora-specific requirement beyond "a working default
browser exists," which `openGmailFallback` does not pre-verify (see above). The user also needs an
active Gmail/Google account signed in for Gmail's compose page to be usable; `MailService` has no
way to check this and does not attempt to.

### Security considerations

- **Host + scheme allowlist**: only `https://mail.google.com/…` is ever passed to
  `shell.openExternal` from `openGmailFallback`. Every other scheme (`javascript:`, `file:`, `http:`)
  and every other host is rejected — `parsed.protocol !== 'https:' || parsed.hostname !== 'mail.google.com'`
  throws before `shell.openExternal` is ever reached. This is structurally guaranteed by
  construction (the base URL is a fixed constant, `to`/`su`/`body` only ever populate query
  parameters, never the scheme or host) and additionally asserted, the same defense-in-depth
  discipline `sendMail`'s mailto scheme guard uses.
- **Not the same allowlist as `navigation-guard.ts`**: `security/navigation-guard.ts`'s `openExternal`
  gates a *different*, broader set of `https:` hosts (fixora.dev, github.com, doc sites) for docs/
  purchase links opened via `window.open`. `mail.google.com` is deliberately **not** added to that
  allowlist — this feature has its own narrow, single-host check instead, kept independent so a
  future change to one gate can never accidentally widen the other.
- **Content is not a secret**: the email body is the user's own suggestion text, already destined
  for an email; putting it in a URL query string (visible in browser history/URL bar) carries the
  same exposure a `mailto:` link already has, not a new one introduced by this feature.

## Known platform limitations

- **macOS**: `LSHandlers` is a private, undocumented plist Apple can change without notice.
  `hasMacMailtoHandler` fails closed — "could not parse" is treated the same as "no handler",
  never assumed to mean success.
- **Linux**: there is no OS-wide equivalent to Windows's registry or macOS's LaunchServices
  database. `xdg-mime` is the most direct signal available, but a minimal system may not have it
  installed at all — the `xdg-email`-on-`PATH` fallback only proves the *tooling* exists, not that a
  handler is registered for the scheme.
- **All platforms**: even when a handler is confirmed registered, `shell.openExternal` resolving is
  still not a guarantee that an application became visible to the user (window managers, remote
  desktops, and locked-down environments can all still swallow the launch). The registry/LaunchServices/xdg
  checks close the *specific, common* gap this bug was reported from (no client configured at all);
  they do not close every conceivable one.
- **URL length**: some mail clients and older Windows shell APIs historically truncate a `mailto:`
  URL around ~2000 characters. `mail-validator.ts` caps subject/body at generous but real limits
  (998 / 8000 characters) to catch a runaway value; a client-specific truncation below that is a
  platform limitation, not something validation can fix.

## Failure modes and recovery behaviour

| Failure | Where it's caught | User sees |
| --- | --- | --- |
| Invalid recipient/subject/body | `validateMail`, before any URL is built | A thrown `Error` with the specific validation message (should not normally happen — the Suggestion System's inputs are generated internally, not raw user text) |
| Non-`mailto:` scheme reaches the guard | `sendMail`, immediately after building the URL | A thrown `Error` (defense in depth; cannot happen through normal construction) |
| No handler registered for the platform | `sendMail`, before `shell.openExternal` is ever called | `MailUnavailableError('No default mail application is configured.')` |
| `shell.openExternal` itself rejects (mailto) | `sendMail`'s try/catch around the call | Same `MailUnavailableError` (the two "no mail client" causes are indistinguishable to the user and don't need to be) |
| Non-Gmail scheme/host reaches the guard | `openGmailFallback`, immediately after building the URL | A thrown `Error` (defense in depth; cannot happen through normal construction) |
| `shell.openExternal` itself rejects (Gmail) | `openGmailFallback`'s try/catch around the call | `GmailFallbackError("Fixora couldn't open Gmail. Please copy the email address instead.")` |

The Suggestion System's `suggestions:share` handler catches `MailUnavailableError` specifically and
returns `{ status: 'no_mail_client', to, subject, body }` — a structured response, not a thrown
`UserFacingError` — so the renderer has the composed recipient/subject/message on hand to offer
**Copy Email Address** / **Copy Subject** / **Copy Message** and the **Open Gmail** fallback in
`MailUnavailableDialog`. `suggestions:shareViaGmail` (F1.5) is the user explicitly clicking that
button; it catches `GmailFallbackError` specifically and returns `{ status: 'browser_failed' }`,
shown as its own toast while the dialog stays open (Copy actions are still right there). Any *other*
thrown error from either handler (a real bug) is left to propagate as an ordinary unexpected IPC
failure.

**Recovery**: the dialog's copy actions let the user complete the email manually in whatever
application they do have, with the same content Fixora would have pre-filled — nothing is lost, the
same information the mailto link carried, delivered by hand instead of automatically. **Open Gmail**
is a second, often faster recovery path for the common case of "no local mail app, but a Gmail
account."

## Security

- **Scheme allowlist (mailto)**: only `mailto:` is ever passed to `shell.openExternal` from
  `sendMail`. `javascript:`, `file:`, `http:`, `https:`, and anything else are structurally
  impossible here (the URL is always built as `mailto:${to}?...`) and are additionally asserted
  against — a `parsed.protocol !== 'mailto:'` check throws before `shell.openExternal` is ever
  reached, as defense in depth against a future refactor, not because today's code can produce
  anything else.
- **Host + scheme allowlist (Gmail fallback)**: only `https://mail.google.com/…` is ever passed to
  `shell.openExternal` from `openGmailFallback` — every other scheme and every other host is
  rejected before the call. See "Gmail web fallback → Security considerations" above for full detail,
  including why this is a separate, narrower check from `navigation-guard.ts`'s general `https:`
  allowlist rather than an addition to it.
- **Encoding**: both `mailto-url.ts` and `gmail-compose-url.ts` build their URLs exclusively through
  `URL`/`URLSearchParams` — never manual string concatenation. `mailto-url.ts` has one documented
  correction on top of the raw API output (space `+` → `%20`, since RFC 6068 mailto expects
  percent-encoding, not `application/x-www-form-urlencoded`); `gmail-compose-url.ts` needs no such
  correction, since a normal `https:` query string's default `+`-for-space encoding is exactly
  correct there.
- **Validation before construction**: `validateMail` rejects malformed input — including a subject
  containing a line break, a classic header-injection vector — before *either* kind of URL is built.

## Runtime logging

Every `sendMail`/`openGmailFallback` call logs, via `console.warn` (never `console.log`, which this
codebase's ESLint config forbids outright — there is no level at which a stray debug trace could
ship unnoticed): platform, validation result, the generated URL, (for `sendMail`) handler-detection
result, and either the resolved or rejected `shell.openExternal` outcome, each with elapsed time. A
rejection additionally logs via `console.error` with the real underlying message (main-process-only;
the user-facing text never carries OS-specific detail, per the existing "Security §9: no path/detail
in user-facing strings" discipline this codebase already follows elsewhere).

## Testing strategy

Each layer is tested in isolation, then the whole thing end to end:

- `apps/desktop/tests/mail-validator.test.ts` — pure validation rules: valid/invalid recipient,
  empty/long/line-break subject, long body, unicode/emoji acceptance.
- `apps/desktop/tests/mailto-url.test.ts` — encoding correctness: spaces → `%20` (not `+`), a
  literal `+` preserved as `%2B`, `%` as `%25`, line breaks as `%0A`, unicode, emoji round-tripping
  losslessly, reserved characters (`&`, `=`, `?`, `#`), long subject/body round-tripping intact.
- `apps/desktop/tests/gmail-compose-url.test.ts` (F1.5) — the Gmail compose URL: the required
  `view=cm&fs=1` base, `to`/`su`/`body` appended correctly, standard `+`-for-space query encoding
  (deliberately *not* the mailto correction), unicode, emoji, line breaks, an empty body, long
  subject/long body round-tripping intact, special/reserved characters, and that the result always
  re-parses as `https://mail.google.com/…`.
- `apps/desktop/tests/mail-handler-detection.test.ts` — each platform's check, present and absent,
  plus "the detection tool itself is unavailable" for all three (`reg` missing, `defaults` missing,
  neither `xdg-mime` nor `xdg-email`/`which` resolving), and macOS key-order independence.
- `apps/desktop/tests/mail-service.test.ts` — full orchestration for both `sendMail` (per platform:
  successful launch, `MailUnavailableError` when no handler, exact required message; validation
  short-circuiting before any handler check or `shell.openExternal` call; unicode/emoji/special-character
  round-trips; the mailto scheme guard) and `openGmailFallback` (F1.5: successful launch with no
  platform pre-check performed, `GmailFallbackError` with the exact required message on a browser
  launch failure, validation short-circuiting, empty body, long subject/body, unicode/emoji/special
  characters, the host+scheme guard) — plus that every lifecycle step of both logs.
- `apps/desktop/tests/suggestions-handlers.test.ts` — both real callers, end to end: `suggestions:share`
  (successful launch with the exact `mailto:` content, `not_found`, and `no_mail_client` from both the
  `shell.openExternal`-rejects and no-handler-registered routes) and `suggestions:shareViaGmail`
  (F1.5: successful launch with the exact Gmail compose URL/content, `not_found`, and
  `browser_failed`) all produce the correct discriminated response.
- `apps/desktop/src/features/suggestions/{suggestions-store,suggestion-panel}.test.ts(x)` — the
  renderer translates both discriminated responses correctly, shows **zero** toasts on either
  success path, and `MailUnavailableDialog`'s exact required title/message/five buttons all work:
  Copy Email Address / Copy Subject / Copy Message copy the right text, Cancel closes without
  calling anything, Open Gmail launches the fallback and closes the dialog silently on success, and
  a browser launch failure shows the exact required toast while keeping the dialog open.

No test relies on the machine it happens to run on: `node:child_process`'s `execFile` is mocked in
every test file that needs it, so a real machine's actual registry/LaunchServices/xdg state can
never silently decide a test's outcome (this was a real gap this session hit directly — the machine
this was built on genuinely has no `mailto:` handler registered, which is what first surfaced BUG-F1-EMAIL-001's second defect).
