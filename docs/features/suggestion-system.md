# Suggestion System (Sprint F1, F1.1, F1.3, F1.4, F1.5)

Local, BYOK-consistent feedback: the user submits a categorized suggestion, it is validated and
persisted on the machine, and they may review, delete, export, or **share** their own history at any
time. Nothing here is workspace-scoped and nothing is ever transmitted automatically — this is
deliberate (Fixora's Beta positioning is offline-first and BYOK-first; see `beta-pivot-byok-first` in
project memory) and mirrors the trust model the repair audit trail already uses (`ai:history`).

Sprint F1.1 added the one deliberate way a suggestion ever leaves the machine: **Email to
Fixora** (named "Share with Fixora" until Sprint F1.3 renamed it for clarity — same button, same
`mailto:` workflow, wording only), which opens the user's own default mail client (via `mailto:`)
with a pre-filled feedback email. Fixora never sends anything itself — there is still no server on
this path. Sprint F1.4 replaced the F1.1 ad-hoc `security/mailto.ts` with the reusable, cross-platform
**`MailService`** (see [mail-service.md](mail-service.md)) after BUG-F1-EMAIL-001 proved that
awaiting `shell.openExternal` was not, by itself, enough to reliably detect "there is no mail client
on this machine."

## Where it lives

```
packages/shared-types/src/suggestions.ts        Suggestion, SuggestionCategory, SUGGESTION_CATEGORY_LABELS,
                                                 ShareSuggestionResponseSchema
packages/shared-types/src/channels.ts           the 6 suggestions:* channel names
packages/shared-types/src/ipc.ts                the 6 channels' zod contracts

apps/desktop/electron/main/db/migrations.ts     migration v5 — the `suggestions` table
apps/desktop/electron/main/suggestions/
  suggestion-validator.ts                        pure validation rules, no I/O
  suggestion-storage.ts                           raw SQL against `suggestions`, Row in/out
  suggestion-repository.ts                        storage → domain `Suggestion` mapping (incl. findById)
  suggestion-service.ts                           validate → persist, JSON export, share-email lookup
  suggestion-share-email.ts                       (F1.1) pure subject/body formatter + OS label mapping
apps/desktop/electron/main/services/mail/         (F1.4) MailService — see mail-service.md, its own doc
apps/desktop/electron/main/ipc/handlers/suggestions.handlers.ts
                                                   IPC surface + the native save-dialog for export +
                                                   the one caller of MailService (owns the recipient constant)
apps/desktop/electron/main/index.ts               wiring: driver → storage → repository → service → handlers,
                                                   constructs the one MailService instance

apps/desktop/src/features/suggestions/
  suggestions-store.ts                            zustand store — the renderer's view of the list
  use-auto-resize-textarea.ts                      the grow-to-fit-content behaviour
  suggestion-form.tsx                              category + message + counter + validation + submit
  suggestion-history.tsx                           the list: per-row delete + share, clear-all, export
  thank-you-dialog.tsx                              shown on a confirmed submit
  mail-unavailable-dialog.tsx                       (F1.4) "no mail client" dialog: Copy Email / Copy Subject
  suggestion-panel.tsx                              composes the above + the "stored locally" note
```

## Layering

Four layers, deliberately kept distinct (more separation than most of the app's existing
domains use, which conflate storage and repository into one `repositories.ts` — this module keeps
them apart because that separation was explicitly asked for):

- **Validator** — pure functions, no I/O. Knows the rules (category must be a known value; message
  10–2000 chars after trimming). Testable without a database.
- **Storage** — the only code that writes SQL against `suggestions`. Moves `Row`s, not domain
  objects; does not know a `Suggestion` type exists.
- **Repository** — storage → domain mapping. Every method returns a `Suggestion`, never a `Row`.
- **Service** — the only layer the IPC handler talks to. Orchestrates validate → persist, owns the
  JSON export format, and (F1.1) looks a suggestion up and hands it to the pure email formatter for
  sharing. A validation failure surfaces as a `UserFacingError` with the exact reason, the same
  pattern every other handler in the app uses.
- **`suggestion-share-email.ts`** (F1.1) — a fifth, sibling pure module rather than logic bolted onto
  the service: it turns `{ category, message, appVersion, platform }` into `{ subject, body }` with
  no I/O, so the exact email text is unit-testable without a database or Electron.

## Data model

```sql
CREATE TABLE suggestions (
  id         TEXT PRIMARY KEY,
  category   TEXT NOT NULL,   -- 'feature' | 'bug' | 'improvement' | 'other'
  message    TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
```

Not workspace-scoped (no `workspace_id`, no FK) — a suggestion is feedback about Fixora itself, not
about a particular project, so it has to exist and be reviewable whether or not any project is open.

## IPC surface

| Channel                | Request                          | Response                        |
| ----------------------- | --------------------------------- | -------------------------------- |
| `suggestions:submit`    | `{ category, message }`           | `{ suggestion }`                 |
| `suggestions:list`      | `{}`                               | `{ suggestions }` (newest first) |
| `suggestions:remove`    | `{ id }`                          | `{ suggestions }`                |
| `suggestions:clear`     | `{}`                               | `{ suggestions }`                |
| `suggestions:export`    | `{}`                               | `{ path: string \| null }`       |
| `suggestions:share`     | `{ id }`                          | `ShareSuggestionResponse` (below) |
| `suggestions:shareViaGmail` (F1.5) | `{ id }`                | `ShareViaGmailResponse` (below)  |

`suggestions:export` opens a native save dialog on the main-process side and writes the file
directly — the renderer cannot write files itself (sandboxed, no `fs`), and a cancelled dialog is a
normal outcome (`path: null`), not an error.

`suggestions:share` takes only an id — never a category/message pair the renderer could supply — so
the email content always comes from what main itself has stored, not from whatever the renderer
claims. Its response is a discriminated union (`ShareSuggestionResponseSchema`,
`packages/shared-types/src/suggestions.ts`):

```ts
| { status: 'opened' }
| { status: 'not_found' }                                                 // id no longer exists
| { status: 'no_mail_client'; to: string; subject: string; body: string } // MailService could not confirm a handler
```

`no_mail_client` (F1.4) carries the composed `to`/`subject`/`body` back — the one time this channel
needs more than a status — so the renderer's `MailUnavailableDialog` can offer Copy Email Address /
Copy Subject / Copy Message and the Gmail fallback (F1.5) without a second round trip. A genuine
unexpected error (not one of MailService's anticipated outcomes) is left to propagate as an ordinary
thrown/IPC-rejected error, not folded into this shape.

`suggestions:shareViaGmail` (Sprint F1.5) is the user explicitly choosing **Open Gmail** from that
dialog. Same trust rule: only an id, main re-derives `to`/`subject`/`body` itself. Response:

```ts
| { status: 'opened' }
| { status: 'not_found' }
| { status: 'browser_failed' }  // shell.openExternal could not launch a browser for the Gmail URL
```

### Email content

Subject: `Fixora Suggestion - <Category>` (the human label, e.g. "Feature request"). Body, in order:
category, the suggestion text verbatim, `Fixora version: <app.getVersion()>`,
`Operating System: <Windows | macOS | Linux>` (mapped from `process.platform`, falling back to the
raw platform string for anything unrecognised), `Workspace: <name | None>`, and
`Timestamp: <ISO 8601>`. `appVersion` and `platform` are injected into the service at construction
time in `main/index.ts` — the service itself never imports `electron`. `workspaceName` and
`timestamp`, by contrast, are computed fresh on every `buildShareEmail` call (via
`service.buildShareEmail(id, { workspaceName })`, with the timestamp taken internally from
`new Date().toISOString()`) because the open workspace can change between requests within the same
process lifetime, unlike the app version or OS. The IPC handlers (`suggestions:share` and
`suggestions:shareViaGmail`) look up the workspace name via `workspaceService.getCurrent()?.name ??
null` at request time; when no workspace is open the body contains the literal string
`Workspace: None`. The pure `buildShareEmail` formatter in `suggestion-share-email.ts` still takes
`workspaceName` and `timestamp` as plain inputs — it never reads the clock or touches `electron`
itself.

### Why `mailto:` needed its own service, not `openExternal`

`apps/desktop/electron/main/security/navigation-guard.ts` already gates `shell.openExternal` behind
"https: only, to an allowlisted host" — a hard-won, deliberate policy (Security §2) that this feature
does **not** weaken. `mailto:` is a different scheme entirely, so a **second, narrower, reusable**
service was built instead: `MailService` (Sprint F1.4; see
[mail-service.md](mail-service.md) for the full design). The Suggestion System is `MailService`'s
only caller today and owns the recipient constant (`novaa.support.team@gmail.com`) itself —
`MailService` is fully generic and has no built-in recipient at all, so any future feature that
needs to send mail takes the same dependency rather than growing a second implementation.

### The `shell.openExternal` resolve/reject gap (BUG-F1-EMAIL-001)

The first fix (F1.1) awaited `shell.openExternal` and rethrew on rejection. Manual validation still
failed: real, non-mocked runtime tracing proved `shell.openExternal('mailto:...')` can **resolve
without rejecting** even when nothing on the machine can handle it — Electron's own contract for
this API is "the OS was asked to launch a handler", not "an application actually opened", and the
two are not the same thing. A machine with no default mail client configured (a fresh dev machine,
exactly the environment this was originally reported from — and, confirmed live during the
investigation, the actual machine this was built on) hits this case: no rejection, nothing for an
awaited call to catch, and the old code went on to report success regardless.

`MailService` (F1.4) closes this properly, per platform, by checking whether a handler is even
registered **before** ever calling `shell.openExternal` — full detail, including the known
limitations of the macOS/Linux heuristics, in [mail-service.md](mail-service.md).

## UI

Reachable from the activity rail (lightbulb icon), rendered full-width like Settings — it needs no
workspace open. The form validates locally with the same min/max the service enforces, so the field
never rejects something the backend would accept or the reverse; the textarea grows with its content
up to a cap rather than scrolling internally. The Send button is disabled only while a request is in
flight, never merely because the current content is invalid — a native `disabled` button does not
fire a click event, which would make clicking it the one moment a first-time user needs validation
feedback the one moment they get none.

An informational note above the form (F1.1) states plainly that suggestions are stored locally and
are never sent anywhere until the user acts — pointing at both **Email to Fixora** (each history
row) and **Export JSON** (unchanged from F1) as the two user-initiated ways out. **Email to
Fixora** is a single click, no confirmation dialog — sharing is not destructive, unlike delete/clear,
which is why it does not share `ConfirmDialog`'s treatment.

On success, nothing else happens visibly — no toast, no dialog (Sprint F1.4 UX requirement:
"do not show unnecessary toast"). On `not_found` or an unexpected IPC error, a toast reports it
(consistent with every other action in this panel). On `no_mail_client`, `MailUnavailableDialog`
opens instead of a toast — it is the one outcome that needs more than a short-lived message, since
the user has no other way to get their suggestion out from here: **Couldn't open your default mail
application**, with **Open Gmail**, **Copy Email Address**, **Copy Subject**, **Copy Message**
(F1.5 added the Gmail fallback and Copy Message; F1.4 shipped Copy Email/Subject alone), and
**Cancel**. Copy actions use the existing `copyToClipboard` helper, which already handles the
main-process round trip and its own success/failure toast. Choosing **Open Gmail** is itself silent
on success (same "no unnecessary toast" rule) and closes the dialog; if the browser itself can't be
launched, the dialog stays open (so Copy is still available) and a toast reports the exact required
message.

## Testing

**BUG-F1-EMAIL-001**, both parts, are fixed — see [mail-service.md](mail-service.md) for full detail
on `MailService`'s own test coverage (validator, both URL builders, per-platform handler detection,
orchestration for both `sendMail` and the Gmail fallback). The Suggestion-System-specific tests:

- `apps/desktop/tests/suggestion-validator.test.ts` — pure validation rules at their boundary values.
- `apps/desktop/tests/suggestion-share-email.test.ts` (F1.1) — the pure formatter: exact subject
  template, all four required fields present in the body, OS label mapping for every platform Fixora
  ships on plus an unrecognised one, and that the message is included verbatim (not re-escaped).
- `apps/desktop/tests/suggestions.test.ts` — storage + repository + service against a real (temp)
  SQLite database, proving the migration and the SQL actually work, not just the logic in isolation.
  Includes `repository.findById` and `service.buildShareEmail` (found, not-found, and
  removed-then-looked-up cases).
- `apps/desktop/tests/suggestions-handlers.test.ts` — the IPC handlers end to end against a real
  temp database and a real (mocked-at-the-`execFile`/`shell.openExternal`-boundary) `MailService`:
  successful launch with the exact `mailto:` content, `not_found`, and both `no_mail_client` routes
  (a rejecting `shell.openExternal`, and no Windows handler registered) each produce the correct
  discriminated response — and submitting alone never touches `shell.openExternal` at all.
- `apps/desktop/src/features/suggestions/suggestions-store.test.ts` — the renderer store, bridge
  mocked, translating all four `ShareSuggestionResponse` variants into the store's own `ShareOutcome`
  shape correctly.
- `apps/desktop/src/features/suggestions/suggestion-form.test.tsx`,
  `suggestion-history.test.tsx` — component behaviour (validation, loading state,
  delete/clear/export/share actions — share is confirmed to appear once per row and to be a single
  click with no confirmation dialog).
- `apps/desktop/src/features/suggestions/suggestion-panel.test.tsx` — renderer-side integration: the
  real store, form, history, and both dialogs mounted together, bridge mocked, proving submit →
  thank-you dialog, share → success (zero toasts), share → not_found/ipc_error → toast, and share →
  no_mail_client → `MailUnavailableDialog` with working Copy Email / Copy Subject, all wire up end
  to end.

## Explicitly out of scope for F1 / F1.1

No server, no sync, no analytics on suggestion content, no admin/triage view (that is a later
decision once there is a channel to receive exports/shared emails through). Categories are a fixed
4-value enum; extending them is a one-line schema + label-map change, not a migration. The share
recipient (`novaa.support.team@gmail.com`) is a single hardcoded address, not a configurable destination —
sharing is always "send to Fixora", never "send to anyone."
