# Manual Validation — Fixora-TestSuite

**Status:** PASSED · 2026-07-30. No release-blocking defects. Layers 2–5 confirmed by the user in the running app.
**Under test:** `main` @ `bdcb7c3` (9-commit series from `6a6df25`)
**Corpus:** `C:/dev/Projects/Fixora-TestSuite` — 164 files, 13,240 lines, 7 languages
**Implementation is FROZEN.** No new features. Only verified release blockers may be fixed.

## Failure classification

Every failure found during validation is recorded in one of four buckets. The bucket decides who
owns it and whether it blocks the release.

| Bucket | Means | Blocks release? |
|---|---|---|
| **A — Analyzer issue** | A finding is wrong, missing, or misclassified. False positive, false negative, wrong severity, wrong repair strategy. | Only if it produces an unsafe repair or floods the list |
| **R — Repair engine issue** | The patch is wrong, does not parse, breaks the file, is misscoped, or the verdict/Apply gate misjudges it. | **Yes** — this is the product's core promise |
| **P — AI provider issue** | The provider refused, throttled, timed out, or returned unusable output. Model quality is included here. | No — but Fixora must *report* it correctly, and that reporting is blocking |
| **M — Expected manual-only limitation** | Fixora correctly declined. No analyzer covers it, or the intended code cannot be determined. | No — this is the safety model working |

The distinction that matters most: **P is not R.** A model returning nonsense is a provider issue;
the repair engine *rejecting* that nonsense is the engine working correctly, and must be recorded as
a pass, not a failure.

---

## Layer 1 — Analyzer sweep (COMPLETE, automated)

Ran the real analyzer over all 164 files headlessly. No GUI needed, so this is settled evidence
rather than a checklist item.

**Result: PASS.** No crash, no hang, no timeout. 164 files in 24s.

| Metric | Value |
|---|---|
| Files analyzed | 164 (1 skipped — `.md`, correctly unsupported) |
| Findings | 114 |
| Files with ≥1 finding | 56 / 164 |
| Severity | 76 error · 38 warning |
| Repair strategy | 103 ai-required · 7 safe-auto · 4 manual |

Findings by source: `tsc` 71 · `eslint` 22 · `ruff` 15 · `complexity` 3 · `css` 2 · `json` 1.

**Active tools:** eslint, ruff, tsc (all bundled). **Not present:** semgrep, mypy, go-vet — so this
run had *no security analysis and no Python type checking*. Expected under ADR-007 (use the
project's own tools, never argue with their CI), and it explains why the suite's injected security
bugs were not reported. Bucket **M**, not a defect.

### Precision check — false-positive controls

The suite documents seven files as clean controls. **All seven came back clean:**

`typescript/src/auth/types.ts` · `typescript/src/db/QueryTypes.ts` · `typescript/src/shared/guards.ts`
· `typescript/src/shared/types.ts` · `typescript/src/users/User.types.ts` · `html/404.html` ·
`html/help.html`

### Finding A-1 — tsc noise on untyped JavaScript · Bucket A · NOT a blocker

35 of 114 findings (**31%**) are tsc artifacts on plain `.js` files in a project with no `@types/node`
and no tsconfig:

- `TS2591` ×23 — *"Cannot find name 'crypto'/'Buffer'. Do you need to install type definitions for node?"*
- `TS18046` ×12 — *"'err' is of type 'unknown'"* (tsc strictness applied to untyped JS)

These are not defects in the user's code, and they are classified `ai-required` — so Fixora offers an
AI repair for something no code edit can fix (the real fix is `npm i -D @types/node`). It clutters the
list and invites futile repairs.

Not a release blocker: nothing unsafe is applied, and the findings are technically true. Recorded for
a post-release analyzer-precision pass. **Do not fix during this freeze.**

### Finding A-2 — HTML reports zero findings · Bucket M · NOT a defect

12 HTML files, 10 documented as buggy, 0 findings. Investigated rather than assumed:

- Balance-checked all 12 files with comments stripped. `login.html` and `dashboard.html` are
  structurally sound (the initial imbalance was comment noise).
- `settings.html` has an unclosed `<p>`, which HTML **implicitly closes** at the next block element.
  Valid markup, correctly not reported.
- The injected HTML bugs are semantic and accessibility defects — `method="GET"` on a login form, a
  password input with no associated `<label>`. Real bugs; no analyzer in this stack covers them
  (no axe, no htmlhint, semgrep absent).

The Tier-B HTML validator is a *syntax* validator and is behaving correctly. Bucket **M**.

### Confirmed working

- **CSS analyzer** — 2 real syntax findings (`animations.css:61`, `components.css:307`).
- **JSON analyzer** — 1 real finding (`analytics-dashboard-layout.json:27`, unquoted property name).
- **Symbol resolution declining correctly** — `TS2304 Cannot find name '__dirname'` in
  `mixed-project/src/api/handlers.ts:66` is classified **`manual`**, not auto-repaired. No candidate
  met threshold, so it refused rather than guessed. This is the safety model working as designed.

---

## Layer 2–5 — Requires the running app

The rest cannot be driven headlessly: it needs the Electron GUI, a configured provider key, and real
user actions. Run `pnpm dev`, open `C:/dev/Projects/Fixora-TestSuite` as the workspace, and work
through the checklist below in order.

Record each failure as `<bucket>-<n>` with the file, the finding, and what happened.

### 2. Repair engine — the blocking layer

| # | Test | Pass criteria |
|---|---|---|
| 2.1 | Repair a `safe-auto` finding (one of the 7) | Applies deterministically, no model call, file still parses |
| 2.2 | Repair `ruff:F401` unused import (python) | Patch removes only the import; indentation preserved |
| 2.3 | Repair `css/components.css:307` (missing `}`) | **Delimiter scope widening** — patch covers the whole rule block, not one line; result parses |
| 2.4 | Repair `css/animations.css:61` | As above |
| 2.5 | Repair `json/analytics-dashboard-layout.json:27` | Valid JSON out |
| 2.6 | Repair an indented nested function (any TS/JS file) | **Indentation preserved** — applied code sits at the original depth |
| 2.7 | Repair in `finding` mode, then `related-scope`, then `ai-file` | Patch card names the mode; splice range visibly widens; skipped findings listed with reasons |
| 2.8 | Repair a finding, then Apply | Diff matches what lands on disk, byte for byte |
| 2.9 | Force a regression (accept a bad patch if one appears) | Verdict `regression`, **Apply disabled**, reason + next step shown |
| 2.10 | Repair `react/src/components/shared/ErrorBoundary.tsx` (8 findings) | Multi-finding file does not produce a cascade or an oversized splice |

Any failure here is **bucket R and a release blocker** unless it is provably the model's output being
correctly rejected (then it is P, and a pass).

### 3. AI provider error UX — new this sprint

| # | Test | Pass criteria |
|---|---|---|
| 3.1 | Remove the API key, attempt a repair | Card: "Your Fixora configuration", status **Invalid API key**, **Open Settings** button works |
| 3.2 | Enter a deliberately wrong key | Same card, status Invalid API key. Never a raw HTTP string |
| 3.3 | Select a model your account cannot access | Status **Model unavailable** or **Authentication failed**, **Change Model** offered |
| 3.4 | Trigger the quota/rate limit again | Distinguishes **Rate limited** (Retry offered) from **Quota exceeded** (Retry *not* offered, credits/model suggested) |
| 3.5 | Disconnect the network, attempt a repair | Status **Network offline**, layer "AI provider — not Fixora" |
| 3.6 | Any provider failure | Card shows Reason · Provider · Model · Status, ≥1 action, and **never** a stack trace or status code |
| 3.7 | Check the developer log for the same failure | Full diagnostics present: provider, model, status, error code, latency, request id, retryable |

### 4. Proceed mode

| # | Test | Pass criteria |
|---|---|---|
| 4.1 | Proceed on a file, preview, accept | Edit lands correctly; scope is the enclosing symbol, never the whole file |
| 4.2 | Switch files mid-run | Proposal does not leak across files |
| 4.3 | Cancel while running | Actually stops; a fresh request afterwards works |
| 4.4 | Ask for an explanation via Proceed | Refuses cleanly (explanation is not an edit intent) |

Note: this resumes the Q3 checklist that was interrupted by BUG-002. **It is not a reproduction
attempt** — that investigation is paused. The `writeTextFile` read-back guard is in place; if a write
ever mismatches it fails closed with `write_verification_failed`.

### 5. Regression smoke

| # | Test | Pass criteria |
|---|---|---|
| 5.1 | Repair History panel | Entries recorded; "Re-run repair" absent on Proceed entries |
| 5.2 | Findings panel across all 7 languages | Correct language badges, severities, repair-state labels |
| 5.3 | A `manual`-classified finding | Repair button visible but disabled, with the real reason |
| 5.4 | An unsupported file (`.md`) | Reads as "not analyzed", not as "broken" |

---

## Failure log

No release-blocking defects were found in Layers 2–5. The two Layer 1 items below stand as recorded — neither blocks the release.

| ID | Bucket | File / finding | What happened | Blocker? | Status |
|---|---|---|---|---|---|
| A-1 | A | tsc on untyped JS (35 findings) | `TS2591`/`TS18046` noise, not code defects | No | Deferred to post-release |
| A-2 | M | `html/*` (12 files) | No findings — semantic/a11y bugs, uncovered by design | No | Not a defect |

---

## Exit criteria

Validation is complete when:

1. Every Layer 2 test passes, or every failure is classified **P** or **M** with evidence.
2. No unclassified failure remains.
3. Every **R**-bucket failure is either fixed (blocker) or explicitly accepted by the user.
4. The full automated suite is still green: 822 desktop · 140 core-ai · 22/0 certification.

Only then does the **Provider Failover** sprint start.
