# Fixora — Manual Test Plan (Human Validation Sprint H1)

Companion to [BUGLOG.md](BUGLOG.md). Every row is one thing to click and observe in the **running**
Electron app (`pnpm dev` or the packaged build) — not a headless test, and not something to infer from
reading code. File a `BUGLOG.md` entry for anything that doesn't match Expected.

**Legend**

- **Offline** — works with no AI provider configured, and no network call. Fully testable right now,
  quota or no quota.
- **AI-required** — makes a request to the configured model (OpenRouter). Blocked while the free quota
  is exhausted (HTTP 429); re-test once it resets.

---

## 1. Workspace — Offline

| # | Action | Expected |
|---|---|---|
| 1.1 | Open Folder (native dialog) on a real project | Workspace name appears in the Files panel; file tree renders |
| 1.2 | Expand/collapse nested folders in the tree | Lazy-loads children; no full-tree flash |
| 1.3 | Open a file from the tree | Opens a tab, content renders in Monaco |
| 1.4 | Open the same file twice | Reuses the existing tab, does not duplicate |
| 1.5 | Close a tab (with and without unsaved changes) | Closes cleanly; unsaved changes prompt or are handled per existing UX |
| 1.6 | Edit a file outside the app (e.g. Notepad), save | File watcher detects the change (tree/tab reflects it, or a reload affordance appears) |
| 1.7 | Reopen the app | Last workspace restores |
| 1.8 | Open a folder with no recognized source files | App does not crash; empty/neutral state shown |

## 2. Analyzer — Offline

| # | Action | Expected |
|---|---|---|
| 2.1 | Open a project with real lint/type violations (e.g. `samples/broken-js`) | Analysis runs automatically; findings populate without any AI call |
| 2.2 | Open a large real repo (this monorepo works) | Analysis completes in seconds, not minutes; UI stays responsive while it runs |
| 2.3 | Open a file with a genuine complexity issue (deeply nested/branching function) | A `cyclomatic-complexity` finding appears — proves the tree-sitter analyzer runs with zero external tools |
| 2.4 | Edit a file to fix a violation, save | Re-analysis runs; the finding disappears |
| 2.5 | Edit a file to introduce a new violation, save | Re-analysis runs; a new finding appears |

## 3. Problems Panel — Offline

| # | Action | Expected |
|---|---|---|
| 3.1 | Open a project with findings of mixed severity | Panel lists all findings; severity counts (All/Error/Warning/Info) are correct |
| 3.2 | Click each severity filter | List filters accordingly; counts stay consistent with the filter |
| 3.3 | Click a finding in the list | Editor jumps to the right file and line |
| 3.4 | Click a finding, open Problem Details | Shows rule id, message, and location |
| 3.5 | Scroll a long findings list (50+ findings) | Smooth scroll — virtualized list, no lag |

## 4. Editor — Offline

| # | Action | Expected |
|---|---|---|
| 4.1 | Type in the editor | Standard Monaco editing — syntax highlighting for the file's language |
| 4.2 | Select a range of text | Selection is visually indicated (used later as Proceed's scope input) |
| 4.3 | Undo/redo (Ctrl+Z / Ctrl+Y) | Works as expected |
| 4.4 | Save (Ctrl+S) | Persists to disk; tab's unsaved indicator clears |
| 4.5 | Switch between multiple open tabs | Each retains its own cursor position and undo history |

## 5. Diagnostics — Offline

| # | Action | Expected |
|---|---|---|
| 5.1 | Save a file with a new violation | Diagnostics update without a manual refresh |
| 5.2 | Open a file with zero violations | Problems panel shows none for that file, others unaffected |
| 5.3 | Diagnostics before any Repair/Proceed apply | Must remain unchanged until you explicitly click Accept/Apply — never mutate on preview alone |

## 6. Repair — AI-required

| # | Action | Expected |
|---|---|---|
| 6.1 | Select a finding, click Repair | Request starts (visible streaming/loading state) |
| 6.2 | Wait for the response | Preview appears showing Original vs Proposed |
| 6.3 | Read the verdict | One of `verified / regression / unresolved / skipped`, shown to the user |
| 6.4 | Click Accept | Patch applies to the file on disk; diagnostics re-run |
| 6.5 | Click Cancel instead | Nothing is written; file and diagnostics unchanged |
| 6.6 | Trigger a 429 (quota exhausted) | Exact message: *"Your OpenRouter quota has been exhausted. Please wait until the quota resets or select another model."* + a Retry button |
| 6.7 | Trigger an auth failure (bad/missing key) | A distinct auth-specific message, not the quota message |

See [B4-MANUAL-ACCEPTANCE.md](B4-MANUAL-ACCEPTANCE.md) for the full 7-language repair acceptance
protocol (JS/TS/React/HTML/CSS/JSON/Python) — run that once the quota resets, it is more rigorous than
the row above.

## 7. Proceed — AI-required (intent classification below is Offline)

| # | Action | Expected |
|---|---|---|
| 7.1 | Click the Proceed tab | Tab switches; prompt form renders (textarea + Proceed button) |
| 7.2 | Submit with an empty/whitespace instruction | Submit stays disabled — no request sent |
| 7.3 | Type "make this button green", submit | Request starts |
| 7.4 | Type "rename this variable", submit | Classified as a valid instruction, not rejected |
| 7.5 | Type "add a JSDoc comment", submit | Classified as a valid instruction, not rejected |
| 7.6 | Type "add loading state", submit | Classified as a valid instruction, not rejected |
| 7.7 | Type gibberish ("asdf qwerty zxcv"), submit | Graceful `unknown-intent` message; **no** provider request sent |
| 7.8 | On success, review preview | Original vs Proposed shown, plus verified verdict and target symbol/lines |
| 7.9 | Click Accept | Applies via the same write path as Repair; diagnostics refresh |
| 7.10 | Click Cancel | Nothing written |
| 7.11 | Trigger a 429 | Same exact quota sentence as Repair, plus a Retry button that re-runs the last instruction |
| 7.12 | Force a model-output failure (if reproducible) | Message includes detected intent, detected language, and a concrete next step (e.g. "try a stronger model") |

Items 7.4–7.6 and 7.7 (the classification decision itself) are **Offline** in effect — classification
runs before any provider call, so you can observe accept/reject behavior even with the quota
exhausted: submitting should still show the streaming/loading state (proving intent passed) rather
than the `unknown-intent` message, right up until the 429 message appears.

## 8. Explain — Offline (out of scope by design)

| # | Action | Expected |
|---|---|---|
| 8.1 | Look at the Explain tab | Rendered disabled, labeled "Explain (soon)" — this is an intentional placeholder, not a bug |

## 9. Apply / Preview / Accept / Cancel — mixed

These are cross-cutting behaviors shared by Repair and Proceed; verify both paths.

| # | Action | Expected | Offline/AI |
|---|---|---|---|
| 9.1 | Preview a proposed edit, then edit the file yourself before clicking Accept | Stale-write guard rejects the apply (the file no longer matches `expectedOriginal`) rather than silently overwriting your edit | AI-required to produce a proposal, but the guard itself is worth confirming |
| 9.2 | Accept a verified proposal | File on disk updates; diagnostics re-run; the applied finding (Repair) or region (Proceed) reflects the change | AI-required |
| 9.3 | Cancel a proposal | File and diagnostics are provably unchanged (diff the file on disk before/after) | AI-required to reach preview, Cancel itself is instant/offline |

## 10. Workspace persistence — Offline

| # | Action | Expected |
|---|---|---|
| 10.1 | Change theme / density in Settings | Applies instantly, no layout shift |
| 10.2 | Restart the app | Theme/density/last workspace persist |
| 10.3 | Enter/replace the OpenRouter API key in Settings | Stored via OS keychain (`safeStorage`); no plaintext key visible in app state/logs |

## 11. Performance — Offline

| # | Action | Expected |
|---|---|---|
| 11.1 | Open a 10,000+ file repo | Tree opens in ~seconds, not minutes; no dropped frames scrolling the tree |
| 11.2 | Open this monorepo itself | Workspace-scoped analysis (one run per tool, not per file) completes in seconds |
| 11.3 | Scroll a long findings list while analysis is still running elsewhere | UI stays responsive |

---

## What requires the AI provider vs. not — summary

**Fully offline (test now, no quota needed):** Sections 1–5, 8, 10, 11, and the classification-only
half of 7 (7.2, 7.7, and the "does it start streaming" half of 7.3–7.6).

**Blocked until OpenRouter quota resets:** Section 6 (Repair), the generation/verify/apply half of
Section 7 (Proceed), and all of Section 9 (Preview/Accept/Cancel need a real proposal to preview first).

---

## Known, intentional limitations (not bugs — do not file)

- **Explain tab is a disabled placeholder** (`proceed-panel.tsx` — `EditModeTabs`). Out of scope until
  a future milestone.
- **JSON trivial-fix repair routes through the AI model, not a deterministic autofix.** The JSON
  analyzer's rule (`packages/core-analysis/src/analyzers/json.ts`) has `fixable: false` — there is no
  engine-level autofix yet. Confirmed during P2.2.1 review; deliberately deferred (would require a
  `certify:record` re-baseline). If you hit this, it is expected today, not a new bug.
  See `PROJECT_STATUS.md` / prior H session notes for the deferral rationale.
- **Project-tool re-analysis re-runs the whole workspace, not just the changed file** (noted in the M3
  audit, `PROJECT_STATUS.md`). Expected to be slower on very large repos on every save; not a crash or
  correctness bug.
- **A tab whose file is deleted on disk keeps a stale Monaco model until the tab is closed** (noted in
  the M2 audit). Cosmetic, known.
- **No live GUI access in this development environment** — the assistant cannot click through the app
  itself; all rows above must be run and reported by a human (you).

---

## Filing a bug found here

Copy the template in [BUGLOG.md](BUGLOG.md), fill in Steps/Expected/Actual from what you actually saw,
and hand it over. One bug per entry — if you hit two unrelated issues in the same session, file two
entries.
