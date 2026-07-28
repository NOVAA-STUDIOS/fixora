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
