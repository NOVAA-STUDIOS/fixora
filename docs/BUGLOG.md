# Fixora — Bug Log (Human Validation Sprint H1)

One entry per bug found during manual validation of the running application. Copy the template below
for each new bug; do not edit past entries except to change `Status`.

**Rules for every entry (H1 discipline):**

- One bug per entry. Do not bundle unrelated symptoms into a single ID.
- `Actual Result` must be what you personally observed running the app — not a guess.
- `Root Cause` and `Files Changed` are filled in by the assistant only after reproducing.
- `Status` moves Open → Fixed → Verified. Only you move it to Verified, after re-testing the fix in
  the running app. The assistant never marks its own fix Verified.

---

## Template

```
### BUG-NNN — <short title>

**Feature:** <Analyzer | Problems Panel | Editor | Diagnostics | Repair | Proceed | Explain | Apply | Preview | Accept | Cancel | Workspace | Performance>
**Reported:** <date>
**Requires AI provider:** <yes | no>

**Steps to Reproduce:**
1.
2.
3.

**Expected Result:**


**Actual Result:**


**Screenshot:**
<path or "none">

**Root Cause:**


**Files Changed:**
-

**Regression Tests Added:**
-

**Status:** Open
```

---

## Log

### BUG-001 — Repair on TS8016 finding appeared to show quota error instead of a fix

**Feature:** Repair
**Reported:** 2026-07-23
**Requires AI provider:** yes

**Steps to Reproduce:**
1. Open `bootstrap.js` in the certification/demo workspace.
2. Select the TS8016 finding (`Type assertion expressions can only be used in TypeScript files.`, line 4).
3. Click Repair.

**Expected Result:**
A repair preview (Original vs Proposed) with Accept/Cancel.

**Actual Result:**
Repair panel showed "Your OpenRouter quota has been exhausted. Please wait until the quota resets or
select another model." instead of a proposal.

**Root Cause:**
No defect. `describeProviderFailure`/`describeModelOutputFailure` (packages/core-ai/src/provider/failure.ts)
only ever produce the quota sentence for a genuine `HTTP_429` from OpenRouter, and `ai.handlers.ts`
logs `[ai:run] entered`/`exited` unconditionally on every invocation — confirmed by terminal evidence
that the free-tier quota really was exhausted at report time. On a clean re-test the next day (quota
reset), a real request completed (`[ai:run] exited { status: 'ok', ms: 51568 }`); the AI proposed
removing the `as any` cast, verification correctly found the patch introduces 2 new `TS2339` errors
(`window.axios` doesn't type-check without the cast), and the safe-apply gate rejected it with a full
explanation. Every layer (Provider → AI model → Repair Engine → Verification → UI) behaved correctly.

**Files Changed:**
- none

**Regression Tests Added:**
- none (no defect; existing regression-verdict tests already cover the reject-on-regression path)

**Status:** Verified — not a bug (confirmed 2026-07-24)

### BUG-002 — test-proceed.js reduced to 60 NUL bytes after Proceed → Accept

**Feature:** Proceed | Apply | Accept
**Reported:** 2026-07-26
**Requires AI provider:** yes

**Steps to Reproduce:**
1. Open `test-proceed.js` (a small hand-created JS file) in Fixora.
2. Place the cursor on a line with a local variable, switch to Proceed, instruct
   "rename the variable x to sum".
3. Click Proceed, wait for the preview, click Accept.

**Expected Result:**
The file on disk is updated to the renamed, correctly-formed source.

**Actual Result:**
Fixora's editor briefly showed the correct renamed code, then displayed a long run of NUL characters.
The on-disk file was independently confirmed (raw hex dump, and separately by VS Code refusing to
open it as text) to be exactly 60 bytes, **every byte `0x00`** — not partially corrupted text, a
uniformly zeroed file the same rough length as the correctly-renamed content would have been.

**Root Cause:**
**UNRESOLVED / NOT REPRODUCIBLE.** An extensive, evidence-driven investigation was carried out and is
preserved in full in this session's transcript (raw byte forensics; full write-path code review of
`spliceLines`/`writeTextFile`/the verification overlay; a mechanical reproduction of the write path
with correct inputs, which produced clean output; live-app reproduction attempts by the reporter
covering: baseline single-shot, three rapid repeats, VS Code open on the same file simultaneously with
Auto Save `afterDelay`, a pure-LF fixture, a rapid double-click on Accept, Windows Defender Protection
History for the incident window (empty), and a full process-tree dump proving only one Fixora instance
was running). **None of the eight controlled reproduction attempts reproduced the corruption.** Every
mechanism considered plausible (write-path logic, timing races, line-ending handling, a concurrent
editor's autosave, a UI double-fire, antivirus interference, an orphaned duplicate process) was either
ruled out with direct evidence or failed to reproduce. The one mechanism that could not be ruled out —
some other, genuinely separate OS process landing a write in the narrow synchronous gap between
Fixora's atomic rename and its own read-back — is real in principle (JS's single-threaded execution
means no same-process actor could cause it) but has no positive evidence identifying what it was.
**Status: Root cause unresolved / non-reproducible — data-integrity hardening complete.**

**Files Changed (hardening, not a fix for this bug):**
- `apps/desktop/electron/main/services/fs/fs-service.ts` — added `verifyWrittenFile()`, called by
  `writeTextFile` after every atomic rename (Repair, Proceed, and manual Save alike). Reads the target
  back and compares raw bytes against what was intended; a mismatch throws a `UserFacingError`
  (`write_verification_failed`) instead of silently reporting success. No automatic rollback — see the
  code comment for why. This makes a recurrence LOUD and REFUSED; it does not explain or prevent
  whatever caused this incident.
- Temporary diagnostic instrumentation (gated on a `proceed-diag` filename substring, added during the
  investigation) remains **in place and active** in `proceed-service.ts`, `ai.handlers.ts`, and
  `fs-service.ts`, deliberately left in for recurrence detection. Do not remove until this bug's status
  changes.

**Regression Tests Added:**
- `apps/desktop/tests/fs-service.test.ts` — 6 tests for `verifyWrittenFile` (clean write, byte
  mismatch, the exact all-NUL/correct-length incident signature, truncation, a plausible-external-edit
  mismatch, and confirming the thrown message never echoes file content).
- `apps/desktop/src/stores/ai-store.test.ts` / `proceed-store.test.ts` — 1 test each confirming a
  write-verification failure surfaces to the UI as a refusal and is never treated as a successful apply
  (Repair and Proceed respectively).

**Status:** Open — root cause unresolved / non-reproducible; data-integrity hardening complete and
accepted (2026-07-27). Do not close until either the mechanism is identified, or a defined bake period
passes with no recurrence (diagnostic instrumentation left active for this reason).

### BUG-003 — `acceptance-scale.test.ts` times out under full-suite parallel load (test-infra, not app)

**Feature:** Performance (test infrastructure, not shipped behaviour)
**Reported:** 2026-07-26 (observed repeatedly through 2026-07-27)
**Requires AI provider:** no

**Steps to Reproduce:**
1. Run the full `apps/desktop` test suite (`vitest run tests/ src/`).
2. Observe `tests/acceptance-scale.test.ts > ... indexes all 10,000 files in the background`.

**Expected Result:**
Passes within its 30s budget.

**Actual Result:**
Times out under full-suite parallel execution load on this Windows dev machine — observed on at least
four separate full-suite runs across this session. **Passes cleanly every time when run in isolation**
(`vitest run tests/acceptance-scale.test.ts`), consistently 2/2, ~30–44s of real test time. The test
file's own existing comment already documents "writing ~10k files can exceed the default 10s hook
timeout on a loaded Windows box" — this is a known category of flake for this specific test, not new.

**Root Cause:**
Environment/resource contention (CPU/disk I/O) when 44 test files run in parallel on this machine, not
a defect in the indexing code itself (which passes reliably standalone). Not investigated further, per
scope — this is a test-stability/performance item, not a Q3 defect and not part of the corruption
investigation.

**Files Changed:**
- none

**Regression Tests Added:**
- none (tracking the flake itself, not fixing a code defect)

**Status:** Open — tracked as a test-stability item. Candidate fixes for later: raise the test's own
timeout further, mark it `.concurrent`-exempt, or run it in its own isolated pool/shard. Not blocking
any release decision on its own; re-run in isolation to confirm real status if it ever shows red in CI.

### BUG-004 — 11 certification manifests carried a stale `sourceHashes` fingerprint (release gate false-fail, and a prior false-green)

**Feature:** Certification (release trust gate, `tooling/certification`)
**Reported:** 2026-07-28 (discovered during post-merge gate re-verification of `sprint-1/ui-stability` → `main`)
**Requires AI provider:** no

**Steps to Reproduce:**
1. On the committed tree at `main` HEAD `88ed97c`, run `pnpm gate:certification`.
2. Observe 10 passed / 11 failed, every failure reading
   `fixture-drift: <file> no longer matches its recorded fingerprint`.

**Expected Result:**
21 / 21 scored samples pass, matching the report already committed in `88ed97c`
(`tooling/certification/results/certification-report.md`, generated `2026-07-28T03:10:56.392Z`,
"Samples passed: 21 / 21 scored", "Failures: _None._").

**Actual Result:**
Reproducibly 10 passed / 11 failed across 5+ consecutive runs, from a clean tree, on both `main` and
the `sprint-1/ui-stability` pointer, with the tsx transform cache cleared. All 11 failures were the
config sidecar of their sample (`tsconfig.json` for react/typescript samples, `config.json` for json
samples) — never the actual analyzed source file.

**Root Cause:**
Not a runner bug, not corruption, not caused by any of the Q1–Q3 work merged this session.
`tooling/certification/src/runner.ts`'s `hashSources`/`collectFiles` has had exactly 2 commits in its
entire history (`6078e0f` creation, `126aa6e` which added the fingerprint feature) and is proven pure
and read-only in `--check` mode. Byte-level evidence:
- Every affected fixture's content is byte-identical to its git blob today, and has been byte-identical
  since **before** `126aa6e` (`git diff 6078e0f HEAD -- <file>` is empty for all 11).
- Re-running the real `captureFindings()` against the current fixture content reproduces the exact
  `expected.findings` already recorded — the engine's behaviour was never in question.
- Of the 11, 7 (all react/typescript samples) share one identical stale hash pair, because they share
  one identical `tsconfig.json` template; the other 4 (json samples) each carry an independent stale
  `config.json` hash.
- Conclusion: at commit `126aa6e` (2026-07-23), `certify:record` was run against a draft of these
  fixtures, the fixtures (a shared tsconfig template standardization, and per-sample config touch-ups)
  were edited afterward, and both landed in the same commit **without re-running `--record`** — the
  manifests were stale from the moment they were committed. Classification: **(D)** — fixture content
  changed after fingerprinting, fingerprint never refreshed to match.
- The `2026-07-28T03:10:56.392Z` clean 21/21 embedded in `88ed97c`'s own committed report is genuine
  (not stale/copied — no other commit between `6078e0f` and `88ed97c` touched these fixtures or that
  report), yet contradicts the now-reproducible failure against provably unchanged bytes and an
  unchanged algorithm. Despite ruling out branch/merge causation, tsx cache staleness, checkout/CRLF
  corruption, and any of this session's 7 new commits, the exact mechanism for that one transient green
  run could not be pinned down with direct evidence and is reported honestly as unresolved. Given the
  drift condition is proven structurally present in the committed tree independent of that run, **the
  earlier 21/21 must be treated as a false green** — certification trust for these 11 samples was not
  actually being enforced at that moment.

**Files Changed:**
- `samples/certification/react/conditional-hook/certification.json` — corrected `tsconfig.json` hash.
- `samples/certification/react/exhaustive-deps/certification.json` — corrected `tsconfig.json` hash.
- `samples/certification/react/valid-clean/certification.json` — corrected `tsconfig.json` hash.
- `samples/certification/typescript/type-in-object/certification.json` — corrected `tsconfig.json` hash.
- `samples/certification/typescript/type-mismatch/certification.json` — corrected `tsconfig.json` hash.
- `samples/certification/typescript/undefined-name/certification.json` — corrected `tsconfig.json` hash.
- `samples/certification/typescript/valid-clean/certification.json` — corrected `tsconfig.json` hash.
- `samples/certification/json/trailing-comma/certification.json` — corrected `config.json` hash.
- `samples/certification/json/unquoted-key/certification.json` — corrected `config.json` hash.
- `samples/certification/json/valid-bom/certification.json` — corrected `config.json` hash.
- `samples/certification/json/valid-clean/certification.json` — corrected `config.json` hash.
- Only the `sourceHashes` values were touched in each file — `expected.findings` was left untouched in
  every manifest, verified unchanged against a fresh `captureFindings()` run before editing.

**Regression Tests Added:**
- `tooling/certification/src/fixture-integrity.test.ts` — walks the real, committed
  `samples/certification` tree (not a synthetic tmpdir) and asserts every recorded `sourceHashes` entry
  in every manifest matches the fixture bytes actually on disk. This test would have failed on all 11
  stale manifests from the day `126aa6e` was committed, instead of surfacing only when someone happened
  to run the gate.

**Status:** Fixed — verified 2026-07-28. 5 consecutive `gate:certification` runs from a clean state all
report 21 / 21, 0 failed. Full gate suite (typecheck, lint zero-warnings, full test suite, accuracy
benchmark, validation, certification, boundaries, ADR, Electron security, secrets) re-run clean with no
regression to Q1/Q2/Q3 behaviour.

### BUG-F1-EMAIL-001 — "Email to Fixora" did nothing: click, no mail client, no error, no feedback

**Feature:** Suggestion System — Email to Fixora (Sprint F1.1)
**Reported:** 2026-07-28, manual validation of Sprint F1.1 (release-blocking)
**Requires AI provider:** no

**Steps to Reproduce:**
1. Submit a suggestion, or use an existing one from history.
2. Click **Email to Fixora**.
3. (Original report) On a machine with no default mail client configured, or (part 2) on any
   machine where `shell.openExternal` resolves for a `mailto:` link without actually opening
   anything — both observed for real during this investigation.

**Expected Result:** Default mail client opens with To/Subject/Body pre-filled, or — if it cannot —
an explicit, visible error.

**Actual Result (before either fix):** Nothing. No mail client, no error toast, no dialog, no
console-visible behaviour. The button was clickable and the click handler fired; nothing after that
point was ever visible.

**Root Cause — two distinct, compounding defects, found in two passes:**

*Part 1:* `openMailClient` called `shell.openExternal(mailto)` with `void` — never awaited, never
checked — and `suggestions:share` unconditionally returned `{ opened: true }`. A genuine rejection
(no mail client registered) was silently discarded at the source; every layer above it (store,
panel) had no failure to react to, because main had already claimed success.

*Part 2 (found after part 1 shipped, still failing in real manual testing):* awaiting alone is not
sufficient. **Real, non-mocked runtime tracing** — a temporary headless Electron harness built for
this investigation, running the actual production `mailto.ts`/`suggestions.handlers.ts` against the
real `shell` module, no test doubles — proved `shell.openExternal('mailto:...')` can **resolve**
(not reject) even when nothing on the machine can handle it. Confirmed twice, live, on the actual
machine this investigation ran on: it genuinely has no `mailto:` handler registered
(`HKEY_CLASSES_ROOT\mailto\shell\open\command` absent), and the awaited call resolved anyway —
exactly the condition originally reported, and exactly the case a rejection-based fix cannot catch.
Every pre-existing test used a bare `vi.fn()` mock for `shell.openExternal`, which can never
reproduce this — a mock has no OS underneath it to lie about.

**Files Changed:**
- `apps/desktop/electron/main/security/mailto.ts` — `openMailClient` now awaits
  `shell.openExternal` and rethrows (part 1). Added `hasWindowsMailtoHandler()`, which queries
  `HKEY_CLASSES_ROOT\mailto\shell\open\command` via the built-in `reg.exe`; `openMailClient` calls
  it on `win32` and refuses **before** ever calling `shell.openExternal` when no handler is
  registered (part 2). Recipient corrected to `novaa.support.team@gmail.com` (was a placeholder,
  `feedback@fixora.dev`, chosen before this address was specified).
- `apps/desktop/electron/main/ipc/handlers/suggestions.handlers.ts` — `suggestions:share` awaits
  `openMailClient`, catches, logs the real cause main-side, and throws a `UserFacingError` the
  router already surfaces to the renderer verbatim.
- `apps/desktop/src/features/suggestions/suggestions-store.ts` — `share()` returns a discriminated
  `{ ok: true } | { ok: false; message }` instead of collapsing every failure into a bare `false`,
  so the real message from main is never discarded.
- `apps/desktop/src/features/suggestions/suggestion-panel.tsx` — shows `result.message` (whichever
  of "not found" or the real mail-client failure actually happened), not a hardcoded guess.
- `docs/features/suggestion-system.md`, `docs/USER-GUIDE.md` — updated for both the corrected
  recipient and the two-part fix.

**Regression Tests Added:**
- `apps/desktop/tests/mailto.test.ts` — `hasWindowsMailtoHandler` (present/absent, via a mocked
  `execFile`); `openMailClient`'s three branches (refuses before calling `shell.openExternal` when
  no Windows handler exists, calls it when one does, and non-Windows platforms skip the registry
  check entirely).
- `apps/desktop/tests/suggestions-handlers.test.ts` — `suggestions:share` end to end: exact
  `mailto:` URL and content on success; a rejecting `shell.openExternal` throws visibly (this is the
  one test the original implementation could never have passed); **the no-Windows-handler-registered
  case throws before `shell.openExternal` is ever called** (part 2's regression test); not-found and
  submit-never-shares-implicitly cases.
- `apps/desktop/src/features/suggestions/suggestions-store.test.ts`,
  `suggestion-panel.test.tsx` — the real error message survives the store and reaches a specific
  toast; a genuine success path is confirmed to raise **zero** toasts (not just "the call happened").
- **Verified by deliberate reversion, not assumption:** all four fixed files were reverted to their
  exact pre-fix content and the full regression suite re-run — exactly the 6 tests written for this
  bug failed (no others), proving they are precise, not incidentally broad. The fix was then
  restored and the suite re-run clean.

**Status:** Fixed — verified 2026-07-28, twice, including live on a real machine with no mail
client registered (the fixed code correctly threw a clear, actionable error in that exact
condition, confirmed via real non-mocked execution, not a test). Full suite: 54/54 desktop test
files, 504/504 tests, typecheck clean, lint zero-warnings. Known residual gap on macOS/Linux (no
single-registry-lookup equivalent to Windows's check) tracked honestly in
`docs/features/suggestion-system.md`, not hidden.

### BUG-005 — `navigation-guard.ts`'s `openExternal` fire-and-forgets `shell.openExternal` (deliberately not fixed yet)

**Feature:** Security (`apps/desktop/electron/main/security/navigation-guard.ts`) — external-link
opening (docs links, GitHub issue link, purchase link), unrelated to the Suggestion System
**Reported:** 2026-07-28, as a finding during the BUG-F1-EMAIL-001 final verification pass
(repo-wide search for `shell.openExternal(`/`void`/fire-and-forget patterns)
**Requires AI provider:** no

**Steps to Reproduce (of the pattern, not a live failure):**
1. Open `apps/desktop/electron/main/security/navigation-guard.ts:44-67` (`export function
   openExternal`).
2. Note line 66: `void shell.openExternal(url.toString());` — the returned Promise is discarded, not
   awaited, and the function's own return type is `void`.
3. This is called from exactly one production call site: `setWindowOpenHandler` (line ~94), which
   fires whenever the renderer's Monaco/webContents tries to open a link via `window.open` or
   `target="_blank"` — e.g. a rule's docs link in the problem-details panel, the GitHub "report this
   bug" link from a contract-violation error, or the Settings "Buy Pro" purchase link.

**Why this is different from BUG-F1-EMAIL-001 (important — do not conflate):**
- **No IPC round-trip exists to carry a failure back.** BUG-F1-EMAIL-001's `suggestions:share` is an
  `ipcMain.handle` the renderer explicitly `invoke()`s and awaits a `Result<T>` from — there was a
  promise on the renderer side that could (and should) have rejected. `setWindowOpenHandler` is an
  Electron-internal callback with no renderer-side promise at all: `window.open()` in the renderer
  returns immediately regardless of what main does asynchronously afterward. Awaiting the call here
  would not, by itself, give the renderer anything to observe — there is no existing channel for
  main to push a "that failed" signal back for this specific interaction.
- **Different dependency reliability.** BUG-F1-EMAIL-001 depends on a *mail client* being installed
  and set as default — frequently absent, especially in dev/CI/fresh-install environments (this is
  exactly what made it a release blocker). This code depends on a *default web browser* — on Windows,
  macOS, and Linux desktop installs, one is present in essentially all real-world configurations.
  Same code shape, materially different real-world failure rate.
- **Different content.** The mailto path carries user-authored suggestion text into the URL (via
  `encodeURIComponent`, still). This path only ever opens `https://` URLs already validated against a
  fixed host allowlist (Security §2) — no user-authored free text is ever part of the URL.

**Current risk level:** Low. Requires *both* (a) an unusual environment with no default browser
associated with `https:`, which is rare on a real desktop OS, *and* (b) the user actually clicking one
of the three external-link entry points, which are not part of any core workflow (Analyzer, Repair,
Proceed, Suggestion submission/history are all unaffected).

**Failure modes:**
- `shell.openExternal` rejects (no browser handler registered, OS refuses the launch) → rejection is
  discarded by `void`; nothing observable happens.
- `shell.openExternal` resolves without any browser actually opening (the same OS-level ambiguity
  documented as a residual risk in BUG-F1-EMAIL-001's fix) → indistinguishable from the above from
  main's perspective, since neither is awaited here regardless.

**User impact:** Clicking a docs link, the GitHub bug-report link, or the purchase link does nothing
visible. No crash, no data loss, no incorrect state — the click is simply inert. Lower-severity than
BUG-F1-EMAIL-001 (which blocked the entire point of the Suggestion Sharing feature); this affects
secondary, non-blocking navigation actions only.

**Can it produce a silent failure?** Yes — structurally the same shape as BUG-F1-EMAIL-001 (a
discarded `shell.openExternal` promise), so by the same reasoning it can fail with zero console
output, zero thrown error, and zero UI feedback. This is exactly why it was flagged rather than
ignored, even though its real-world likelihood is much lower.

**Proposed future fix (not implemented yet):**
1. Await `shell.openExternal` inside `openExternal()` and log a `console.error` on rejection (parity
   with `mailto.ts`'s main-side logging) — cheap, safe, no behavior change on the success path.
2. Decide whether a user-visible signal is worth building for this specific interaction. Since
   `setWindowOpenHandler` has no return channel to the renderer, this would require either (a) a new
   one-way main→renderer event (e.g. `system:externalOpenFailed`) the shell subscribes to and turns
   into a toast, or (b) accepting that awaiting + logging (main-process visibility only) is
   sufficient for a low-severity, non-blocking path and deferring a full UI-visible fix until this
   is reported as an actual, reproduced user complaint (the same "await, log, hold for a real signal
   before over-building" discipline already applied to BUG-002).
3. If pursued, add a regression test mirroring `suggestions-handlers.test.ts`'s
   rejecting-`shell.openExternal` case — mocking a rejection and asserting it no longer disappears
   silently.

**Priority:** Low/P3 — track and revisit, not urgent.

**Blocking or non-blocking:** **Non-blocking.** Does not affect Analyzer, Repair, Proceed, or the
Suggestion System (submit/history/export/email-share all unaffected). Not a release blocker on its
own; recorded so the pattern is not forgotten or rediscovered from scratch later.

**Files Changed:** None — investigation/documentation only, no code changed for this entry.

**Regression Tests Added:** None yet — deferred to the future fix above.

**Status:** Open — deliberately deferred, not fixed. Linked from `PROJECT_STATUS.md` so it is visible
alongside BUG-002/BUG-003 as a known, tracked, non-blocking item.
