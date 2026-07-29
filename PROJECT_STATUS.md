# Fixora — Project Status

**Updated:** 2026-07-29 · **Mission:** ship a **BYOK Public Beta** (pivot 2026-07-16).
**Release:** `v0.9.0-beta.1` was tagged **code complete** 2026-07-18 (see the Beta track table below —
Phases A–F all done; `pnpm run ci` green at 323 tests). Since that tag, substantial additional work has
been built on `sprint-1/ui-stability` and is **not yet released**: Proceed Mode (a second editing
pipeline alongside Repair), a four-part reliability/validation sequence (H1→Q1→Q2→Q3) hardening both
Repair and Proceed, the Suggestion System (Sprint F1) and Welcome Experience (Sprint F2, both now
**COMPLETE**), and a module-by-module pre-launch **Beta Readiness Audit** pass (A1–A4 closed, no
blockers remaining; A5+ not started). See "Post-beta-tag work" and "Beta Readiness Audits" below for
the current, authoritative state of that branch.
Owner-side launch steps for `v0.9.0-beta.1` (license keypair + Stripe link, installer build on a build
machine, clean-machine acceptance — [RELEASE-CHECKLIST.md](docs/RELEASE-CHECKLIST.md)) have not been
confirmed done and are unaffected by this update.

---

## Post-beta-tag work: Proceed Mode + reliability sequence (branch `sprint-1/ui-stability`)

Everything in this section happened **after** the `v0.9.0-beta.1` tag above and is **unreleased** —
it lives only on `sprint-1/ui-stability`, not in any tagged release or the published beta.

### Proceed Mode (P2.1 → P2.2.1) — done

A second editing pipeline alongside Repair: a natural-language instruction ("make this button green")
is turned into a VERIFIED edit proposal, reusing the Repair engine's verification/apply machinery rather
than duplicating it.

- **P2.1 — Intelligent Editing foundation.** Deterministic intent classifier, AST scope detection
  (smallest enclosing symbol, never the whole file), editing context builder (reuses the repair budget +
  secret gate), edit prompt/schema, orchestration service with 6 outcomes unit-tested, a minimal Proceed
  tab. Verification's `computeVerdict` extended with `target: null` for edit mode — the Repair path is
  byte-identical (proven), not forked.
- **P2.2 / P2.2R / P2.2.1 — shipped into the running application.** Live editing acceptance harness;
  the `proceed:run` IPC channel + worker `resolveScope` wired through `AnalysisHost`; the Proceed tab
  mounted beside Repair with its own store; Apply reuses `ai:applyRepair` (the one verified write path —
  never a second one); Repair + Proceed failure UX stabilized (`retryable` classification surfaced
  consistently in both panels).

### Reliability / validation sequence (H1 → Q1 → Q2 → Q3) — done, Q3 formally FROZEN 2026-07-27

Run with the same audit-then-fix discipline as the original M0–M3 milestone reviews: one confirmed,
reproduced defect at a time, smallest safe fix, regression test, re-verify gates, human validation in
the running app before calling anything closed.

| Sprint | Scope                                                                                                                                                                                        | Status                                                                                                                                                                                                                                                                        |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **H1** | Human validation of the running app; bugs found/fixed one at a time, logged in [BUGLOG.md](docs/BUGLOG.md)                                                                                   | Closed                                                                                                                                                                                                                                                                        |
| **Q1** | Analyzer accuracy — false positive/negative/line-precision defects in `core-analysis` only                                                                                                   | Closed — 4 confirmed defects fixed (complexity, JSON, symbol resolution); certification 21/21, benchmark 100%                                                                                                                                                                 |
| **Q2** | Repair reliability — success rate, deterministic-vs-AI routing, verification correctness                                                                                                     | Closed 2026-07-26 — Fix #1 (retryable provider-failure UX parity Repair/Proceed), Fix #2A (deterministic `safe-auto` repairs now route to a worker-hosted `deterministicRepair()` instead of silently going through the AI pipeline); both human-validated in the running app |
| **Q3** | Proceed final stabilization — a full audit of the Proceed pipeline (intent, scope, request construction, edit quality, verification, preview/apply/cancel, provider failures, state machine) | **Formally FROZEN 2026-07-27** — see below                                                                                                                                                                                                                                    |

**Q3 defects — all four implemented, gate-verified, and human-validated in the running app (TESTs 1–10, all PASS):**

1. **Explanation-intent refusal** — a question-style instruction ("explain what this does") is refused before it ever reaches the AI provider, instead of being silently treated as an edit request.
2. **Proposal/file scoping** — a pending Proceed preview is invalidated the instant the active editor tab changes away from the file it was generated for, so Accept can never write to the wrong file.
3. **Immutable Retry replay** — Retry replays the exact captured request (instruction, file, selection) from the failed attempt, never re-derived from whatever the cursor/tab happens to be at retry-time.
4. **Real in-flight cancellation** — a genuine Cancel action aborts the actual in-flight request (a `proceed:cancel` IPC channel mirroring Repair's existing `ai:cancel` pattern), with a renderer-side staleness token so a late/cancelled result can never overwrite newer state.

**BUG-002 — data-integrity incident, unresolved / non-reproducible, accepted as a tracked risk.**
During Q3 human validation, a test file was reduced to 60 bytes of all-`0x00` content after a normal
Proceed→Accept. An extensive evidence-driven investigation (full write-path code review, a mechanical
reproduction of the write path with correct inputs — clean, 8 controlled live-reproduction attempts
covering rapid repetition/CRLF-LF/concurrent-editor/UI-race/antivirus/process-duplication hypotheses,
a Windows Defender Protection History check, a full process-tree audit) could not reproduce it or
identify a root cause. **Root cause remains unresolved.** A permanent, root-cause-agnostic safety net —
`verifyWrittenFile()` in `apps/desktop/electron/main/services/fs/fs-service.ts` — now reads every write
back (Repair, Proceed, and manual Save alike, since they share one `writeTextFile` function) and refuses
with a clear, actionable error if the on-disk bytes don't match what was intended, instead of silently
reporting success. No automatic rollback (deliberate — could destroy a legitimate concurrent edit).
Temporary `[Q3-DIAG]` diagnostic instrumentation remains **intentionally active** (gated on a
`proceed-diag` filename substring) for recurrence detection. Full record: [BUGLOG.md](docs/BUGLOG.md)
BUG-002. This is an accepted, non-blocking, separately tracked risk — it did not block the Q3 freeze.

**BUG-003 — `acceptance-scale.test.ts` flakes under full-suite parallel load, tracked separately.**
Passes cleanly every time run in isolation; times out under full-suite parallel contention on this
machine. Test-infrastructure/performance item, not an application defect. See
[BUGLOG.md](docs/BUGLOG.md) BUG-003.

**BUG-F1-EMAIL-001 — "Email to Fixora" did nothing (click, no mail client, no error), now fixed.**
Two compounding defects: (1) `shell.openExternal` was called with `void` — never awaited, a real
rejection was discarded and the handler claimed success regardless; (2) even after awaiting,
`shell.openExternal` can *resolve* without any application actually opening — confirmed live, twice,
via real (non-mocked) runtime tracing on a machine that genuinely has no `mailto:` handler
registered. Fixed by awaiting/rethrowing (part 1) plus a Windows registry pre-check that refuses
before ever calling `shell.openExternal` when no handler is registered (part 2). Verified by
deliberately reverting the fix and confirming the exact regression tests fail, then restoring and
re-confirming they pass. See [BUGLOG.md](docs/BUGLOG.md) BUG-F1-EMAIL-001.

**BUG-005 — `navigation-guard.ts`'s `openExternal` fire-and-forgets `shell.openExternal`, low
severity, deliberately deferred.** Found during the BUG-F1-EMAIL-001 (Suggestion Sharing) final
verification pass's repo-wide search for the same fire-and-forget shape. Same code pattern as
BUG-F1-EMAIL-001's root cause, but lower risk: it opens `https://` docs/GitHub/purchase links (a
default browser is present on virtually every real desktop, unlike a mail client), and
`setWindowOpenHandler` has no renderer-side promise to reject even if awaited, so there is no
existing channel to carry a failure back to the UI. Non-blocking — does not touch Analyzer, Repair,
Proceed, or the Suggestion System. Not fixed yet (explicitly deferred, not forgotten). Full record:
[BUGLOG.md](docs/BUGLOG.md) BUG-005.

**No additional `sprint-1/ui-stability` scope is currently documented.** No repository document
enumerates further UI-stability work beyond the Proceed Mode build and the H1→Q3 reliability sequence
above. This is recorded as a gap, not as confirmation that the branch's scope is complete.

### Sprint F1 — Suggestion System — **COMPLETE**

A local-first feedback channel, independent of Analyzer/Repair/Proceed: category-selected suggestions
(feature/bug/improvement/other), persisted to SQLite (migration v5, table `suggestions`, not
workspace-scoped — this is feedback about Fixora itself), with history, JSON export, and two ways to
actually send one to Fixora.

- **F1 core** — category selector, auto-resizing message editor with a character counter, input
  validation, submit loading state, a thank-you confirmation, suggestion history (newest first),
  and export to a JSON file via the native save dialog.
- **F1.1 — Email to Fixora.** A pure, synchronous `buildShareEmail()` formatter composes the
  subject/body (category, message verbatim, app version, OS, workspace name, timestamp); the
  `suggestions:share` handler opens it via `MailService`.
- **F1.4 — `MailService`.** A reusable, cross-platform (Windows registry / macOS LaunchServices /
  Linux xdg-mime) `mailto:` opener with a pre-send handler-presence check, so a missing mail client is
  reported as `no_mail_client` rather than silently doing nothing — see BUG-F1-EMAIL-001 below.
- **F1.5 — Gmail Web fallback.** When no mail client is detected, the renderer's
  `MailUnavailableDialog` offers **Open Gmail** (`suggestions:shareViaGmail`, opens Gmail compose in
  the browser), **Copy Email Address**, **Copy Subject**, **Copy Message**, and **Cancel** — so a
  suggestion is never a dead end even with nothing configured.
- **F1.3** — all user-facing text renamed from "Share with Fixora" to **"Email to Fixora"**, matching
  what the feature actually does now that Gmail is a named alternative alongside it.
- **Finalization polish** — the email body now also includes the current **Workspace** name (or the
  literal `Workspace: None` when no project is open, looked up fresh per request via
  `workspaceService.getCurrent()`, not baked in at construction time like `appVersion`/`platform`) and
  a **Timestamp** (`new Date().toISOString()`, generated per call).
- Also in this sprint: the navigation rail's category label no longer clips (`leading-none` →
  `leading-tight`), with a regression test.

Bugs found and fixed while building this sprint: **BUG-F1-EMAIL-001** ("Email to Fixora" did nothing —
no mail client, no error, no feedback; two compounding root causes, both fixed and regression-tested)
and **BUG-005** (a lower-severity, same-shape fire-and-forget `shell.openExternal` call in
`navigation-guard.ts`, found during BUG-F1-EMAIL-001's repo-wide follow-up search, deliberately
**not** fixed yet). Full detail: [BUGLOG.md](docs/BUGLOG.md).

Architecture: `docs/features/suggestion-system.md` (Suggestion System) and
`docs/features/mail-service.md` (`MailService`). Manually validated in the running app (Email to
Fixora, Gmail fallback, export, history all confirmed working) with full regression test coverage.
Does not touch Analyzer, Repair, or Proceed.

### Sprint F2 — Welcome Experience — **COMPLETE**

A premium first-run and startup surface, independent of Analyzer/Repair/Proceed/Suggestion System:
a splash screen with a bounded (not artificial) minimum-visible time, a Home screen shown whenever
no project is open, Quick Actions, and pinnable Recent Projects.

- **Splash screen** — a ~1.8s floor exists only so the staggered logo/wordmark entrance animation
  finishes playing, never a manufactured "premium" wait on top of that; the loading indicator hides
  the instant initialization actually resolves; a 20s hang-safety-net guarantees the "never strand
  the user" rule holds even if initialization never settles.
- **Home screen** — hero + **Quick Actions** (Open folder, Open recent, Documentation, What's New —
  the latter two as in-app dialogs, no network required) + **Recent Projects** with pin support
  (migration v6 adds `workspaces.pinned_at`; a pinned project sorts to the top; a new
  `workspace:setPinned` IPC channel).

Architecture: `docs/features/welcome-experience.md`. Does not touch Analyzer, Repair, Proceed, or
the Suggestion System.

## Beta Readiness Audits (A1 → A4+) — pre-launch hardening pass

A module-by-module audit of the Public Beta surface, each pass reviewing one module against a fixed
rubric (UX, accessibility, performance, error handling, trustworthiness, production readiness),
fixing only genuine beta-blocking findings, and explicitly deferring lower-severity/optimization
findings rather than scope-creeping the pass. Each closed audit's findings, fixes (if any), and
final score are the authoritative record — this section tracks status only.

| Audit | Module | Status | Blockers found | Blockers remaining |
| ----- | ------ | ------ | --------------- | ------------------- |
| **A1** | Welcome Experience | ✅ **Closed 2026-07-29** — remediated | 3 (splash focus containment, Recent Projects context-menu discoverability, Documentation dialog's false bundling claim) | 0 — all fixed, re-audited, score 9/10 |
| **A2** | File Explorer & Workspace | ✅ **Closed 2026-07-29** — remediated | 2 (silent data loss on workspace switch; file tree's `listbox`/`option` ARIA roles had no keyboard implementation) | 0 — all fixed, re-audited, score 8.5/10 |
| **A3** | Analyzer | ✅ **Closed 2026-07-29** — accepted, no remediation required | 0 — no genuine beta blockers found | 0 — score 7.5/10; several Medium/High-severity **optimization and test-coverage findings deferred post-beta** (see `docs/BUGLOG.md` if promoted; not tracked as defects since none are blocking) |
| **A4** | Problems Panel (Findings UI) | ✅ **Closed 2026-07-29** — remediated | 3 (no error state on a failed run; `VirtualList`'s `listbox`/`option` roles had no keyboard implementation, same defect class as A2's file tree; a hardcoded 500-row backend limit could silently disagree with the displayed "N problems" count) | 0 — all fixed, re-audited, score 9/10. See `docs/features/problems-panel.md` |
| A5+ | (next module) | ⏳ Not started | — | — |

**A3's deferred (non-blocking) findings, explicitly not implemented per instruction:** analysis
results are fully buffered before the Problems panel updates (contradicts the engine's own "streams
incrementally" doc comment — a real perceived-hang risk on large repos, but a disclosed, deliberate
trade-off per ADR-035, not a hidden defect); the desktop-side analysis orchestration layer
(`analysis-service.ts`/`analysis-host.ts`/`analysis.handlers.ts`/`analysis-worker.mjs`) has zero
automated test coverage; the complexity analyzer's tree-sitter parse call is the one place a single
bad file can abort an entire analysis run instead of degrading gracefully like every other analyzer;
analyzers run sequentially rather than concurrently. None of these block Beta; all are candidates
for a post-beta hardening pass, or for promotion to blocking status if real-world beta usage shows
otherwise.

## Mission pivot (2026-07-16) — BYOK-first Public Beta

Priorities changed to shipping a stable, trustworthy Public Beta. The beta is **BYOK-only** (bring your
own key, OpenRouter first): AI runs desktop→provider direct, so there is **no account/sign-in and no
server on the AI path**. Consequently the managed-tier backend (`fixora-api`, built + green in its own
repo, commits `e2add0a..286cc5b`) and the desktop Supabase PKCE sign-in are **deferred to v1.1** (the
half-built desktop auth is preserved in `git stash@{0}`). Revenue at launch = **Stripe Payment Link +
offline Ed25519 license** (no billing backend). Deferred to v1.1: teams, enterprise, marketplace,
plugins, cloud sync, API platform, analytics/reports, collaboration, org management.

### Beta track

| Phase     | Scope                                                                     | Status                                                                              |
| --------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Beta-M5 A | `@fixora/core-ai`: secret gate + provider abstraction + OpenRouter (BYOK) | ✅ done + verified                                                                  |
| Beta-M5 B | context builder (reuses M3) + task profiles + schema-constrained output   | ✅ done + verified                                                                  |
| Beta-M5 C | keychain BYOK key store + AI IPC + streaming + settings/finding UI        | ✅ done + verified (live safeStorage)                                               |
| Beta-M5 D | verified repair: overlay + re-run analyzers + verdict + diff + apply/copy | ✅ done + verified (live worker)                                                    |
| Beta-M5 E | repair history (SQLite v4) + History panel; AI panel in its own pane      | ✅ done + verified                                                                  |
| Beta-M5 F | acceptance (over-HTTP + live smokes) + audit + red-team + docs/ADRs       | ✅ done — see [BETA-ACCEPTANCE.md](docs/BETA-ACCEPTANCE.md), ADR-036/037/038        |
| Licensing | Stripe link + offline Ed25519 license (BYOK free, Pro = supporter)        | ✅ done + verified — see [LICENSING.md](docs/LICENSING.md)                          |
| Packaging | Windows installer (unsigned beta) + WASM-worker vendoring                 | ✅ config + fix + docs — build on owner machine ([PACKAGING.md](docs/PACKAGING.md)) |
| Website   | download page + privacy + pricing + email capture                         | ✅ done ([website/](website/))                                                      |
| Docs      | user guide + README + release checklist                                   | ✅ done ([USER-GUIDE.md](docs/USER-GUIDE.md))                                       |
| Release   | `pnpm run ci` green (323 tests + all gates) · tag v0.9.0-beta.1           | ✅ code complete; owner clean-machine gate remains                                  |

---

## Milestones

| #             | Milestone                                                     | Status                                                  | Notes                                                                                     |
| ------------- | ------------------------------------------------------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| —             | Blueprint                                                     | ✅ Signed off 2026-07-13                                | 28 ADRs accepted                                                                          |
| **M0**        | **Foundations**                                               | ✅ **Approved — audited + red-teamed**                  | Signed off 2026-07-14                                                                     |
| **M1**        | **Design system & app shell**                                 | ✅ **Approved — audited + red-teamed**                  | Signed off 2026-07-14                                                                     |
| **M2**        | **Workspace, editor, local persistence**                      | ✅ **Approved — audited + red-teamed**                  | Signed off 2026-07-15                                                                     |
| **M3**        | **Deterministic analysis engine**                             | ✅ **Approved — audited + red-teamed**                  | Signed off 2026-07-16                                                                     |
| **M4**        | **Backend, auth, entitlements**                               | ✅ **Built (fixora-api A–E), deferred to v1.1**         | BYOK beta needs no server; ready to switch on                                             |
| **Beta-M5**   | **Verified AI Repair (BYOK)**                                 | ✅ **Done — Phases A–F all done**                       | The beta product; see Beta track above. Tagged `v0.9.0-beta.1`, 2026-07-18                |
| **Post-beta** | **Proceed Mode (P2.1–P2.2.1) + reliability sequence (H1→Q3)** | ✅ **Done, unreleased** — Q3 formally frozen 2026-07-27 | Branch `sprint-1/ui-stability`; not in any tagged release. See "Post-beta-tag work" above |
| **F1**        | **Suggestion System (F1, F1.1, F1.3–F1.5)**                   | ✅ **COMPLETE 2026-07-28**                              | Not workspace-scoped, not in any tagged release yet. See "Sprint F1" above                |
| **F2**        | **Welcome Experience (splash + Home screen + pin support)**   | ✅ **COMPLETE 2026-07-29**                              | Not in any tagged release yet. See "Sprint F2" above                                      |
| **A1–A4**     | **Beta Readiness Audits (Welcome Experience, Workspace, Analyzer, Problems Panel)** | ✅ **Closed 2026-07-29** — no blockers remaining  | A5+ not started. See "Beta Readiness Audits" above                                        |
| M6+           | Teams / enterprise / marketplace / cloud                      | ⏸ v1.1 backlog                                          | Deferred by the beta pivot                                                                |

---

## M3 acceptance criteria — verified, not asserted

The roadmap defines one: _"Runs against real repos and produces findings that match what those repos' own CI
produces. Fixora is genuinely useful at this milestone with no LLM at all."_

| Check                                        | Status | How it was verified                                                                                                                                                                                                                                                                                   |
| -------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Findings match the tool's own output (TS/JS) | ✅     | A **live** acceptance test runs the monorepo's real `eslint` subprocess over a fixture with real violations; the adapter yields exactly those violations, grounded (right file/line, enclosing symbol via tree-sitter, stable id). They match because it **is** eslint (`acceptance-eslint.test.ts`). |
| Useful with the LLM switched off (ADR-002)   | ✅     | Verified in the running app: analysis on a real JSX project produced a genuine `cyclomatic-complexity` warning on a complex `Contact` function — from the tree-sitter analyzer, **no external tool and no AI**. Clicking it opened the file at the line.                                              |
| The findings panel displays results          | ✅     | Live: the Problems panel rendered the finding with severity filters (All/Error/Warning/Info counts), and click-to-open jumped to `Contact.jsx:341` in Monaco.                                                                                                                                         |
| Analysis scales (a real repo, not a toy)     | ✅     | The workspace-scoped engine (ADR-035) runs each tool **once**, not per file; the real-project run completed in seconds (was unusable when tsc/etc. ran per file).                                                                                                                                     |

**Environment note on the other two languages.** `go`, `ruff`, `mypy`, `semgrep` are not installed on this
machine, so their _live_ acceptance must run where those toolchains exist. Their adapters are unit-tested
against **real-format** tool output and share the exact subprocess + grounding path proven live with eslint;
the tree-sitter layer (symbols, imports, call graph, complexity) has per-language conformance tests for all
four languages.

**M3 build stats:** `@fixora/core-analysis` (pure TS, no Electron/React) — the unified `Finding` model,
tree-sitter parsing for TS/JS/Python/Go (symbols, imports, within-file call graph), 7 analyzers (complexity +
eslint/tsc/ruff/mypy/go-vet/semgrep) behind one workspace-scoped interface, capability detection, a no-shell
subprocess runner. Plus SQLite findings persistence (migration v3), the analysis IPC contracts, the
utility-process host + ESM worker (ADR-017), and the virtualised findings panel. Tests: **core-analysis 47**,
desktop suite green.

---

## M3 audit + red-team (2026-07-16) — passed

Per the standing instruction, an internal audit ran before marking M3 done and a red-team before requesting
approval.

| Pass      | Finding                                                                                                                                                                                                                      | Resolution                                                                                                                                                                                                    |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Audit** | Project-scoped tools (`tsc`/`mypy`/`go vet`) were invoked **once per file** — O(files × project), unusable on a real repo (the app hung "Analyzing…" on this monorepo).                                                      | Re-architected to workspace-scoped analyzers (ADR-035): each tool runs once, findings distributed by file. Verified fast on a real project. This was the difference between a demo and a tool.                |
| **Audit** | `tree-sitter-wasms` (the grammar `.wasm` the worker loads at **runtime**) was a `devDependency` — a production install would omit it and grammar loading would fail.                                                         | Moved to `dependencies`.                                                                                                                                                                                      |
| **Audit** | `pnpm dev` black-screened while the built app rendered (found because the built app was verified, not the dev server). The strict CSP blocked `@vitejs/plugin-react`'s inline Fast-Refresh preamble, so React never mounted. | A dev CSP **nonce** (Vite `html.cspNonce`) allows the preamble without `'unsafe-inline'`; the strict `<meta>` is stripped in the dev server only. Production CSP is untouched. `pnpm dev` verified rendering. |

**Assessed and clean:** the worker only reads files main vetted (path guard + secrets denylist + ignore +
size); the subprocess runner never uses a shell (args as an array — command-injection defence); findings are
kept only for the vetted file set; the worker is timeout-, cancel-, and crash-isolated (ADR-017), so a runaway
tool degrades one panel, never the editor. **Assessed and accepted (documented risk):** analysis runs the
**workspace's own tooling** (ADR-007) — eslint plugins, a tsconfig, etc. — which is code execution, the same
trust a developer already extends by opening a repo in their editor and running its build; the utility-process
isolation (ADR-017) is the containment, and tightening that sandbox is explicitly M6's job. **Noted for later:**
project-tool incremental granularity (re-analysis re-runs the workspace, not one changed file); the worker
buffers all findings before posting (bounded in practice; a streaming refinement).

**Environment note:** the `gitleaks` gate could not run (binary absent); a manual secret scan of the M3 diff
found none. The gate stays mandatory in CI.

---

## M2 acceptance criteria — verified, not asserted

The roadmap defines three. Each was checked against the running app or a real fixture, not asserted.

| Criterion (Roadmap M2)                                 | Status | How it was verified                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------ | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Opens a 10,000-file repo in <2s with no dropped frames | ✅     | A real 10,001-file fixture (`acceptance-scale.test.ts`): `open()` + root `listDirectory` measured at **~70ms** with a 500ms ceiling that fails if a regression walks the whole tree on open. Cost is O(root), not O(repo) — the tree loads lazily. "No dropped frames" is the VirtualList windowing the flat node array, exercised in the running app. |
| App fully functions offline and signed-out             | ✅     | There is **no auth in M2 and zero network primitives** in shipping code (grep: the only `fetch` is a navigation-guard _test payload_ the guard blocks). Strict CSP (9 tests) + navigation guard (23 tests) enforce it structurally. The app opened, listed, and rendered files with no network in the running app.                                     |
| DB migration from empty DB and v1→v2 both succeed      | ✅     | `database.test.ts`: empty→current builds both tables; a v1-only DB with a row migrates to v2 with the row intact and the new table present; idempotent re-open; backup-before-migrate; and a garbage file quarantines to a fresh DB instead of crashing (DB §1).                                                                                       |

**M2 build stats:** node:sqlite persistence (WAL, forward-only migrations, repositories), a path-guarded
FS service + secrets denylist, workspace service + typed workspace/fs IPC, a virtualised lazy file tree,
Monaco under strict CSP (tabs + models + diff editor), a debounced ignore-aware file watcher, and the
settings surface (theme, density, telemetry opt-in, keybindings). Tests **77 → 154** (desktop) plus the ui
package. Every runnable CI gate green.

---

## M2 audit + red-team (2026-07-15) — passed

Per the standing instruction, an internal audit ran before marking M2 done and a red-team review before
requesting approval.

| Pass         | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Resolution                                                                                                                                                                                                                                                                                         |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Red-team** | `workspace:open` took the folder path **straight from the renderer** and made it the trusted FS root. Since the renderer is treated as hostile (I1), a compromised renderer could set the root to any absolute path (e.g. `C:\`) and read non-secret files under it via `fs:listDir/readFile`. Impact was already bounded (no network egress, secrets denylist, path guard), but turning an arbitrary renderer string into the FS root is a defense-in-depth gap. | The trust boundary now sits at the IPC handler: `workspace:open` refuses any path the user did not pick this session (native dialog) and that is not already a known recent. `open()` stays the trusted primitive for internal callers (restoreLast, indexing, tests). Two tests; app re-verified. |

**Assessed and clean:** the path guard resolves symlinks/junctions/UNC then checks path-segment boundary
(never string prefix), fuzz-tested with 500 generated traversals; the secrets denylist blocks `.ssh`,
`.env`, `*.pem`, `id_rsa`, `.git/config` etc. on every `readTextFile`; the watcher emits **workspace-
relative** paths only (no absolute-path leak), does not follow symlinks, and is debounced + ignore-aware
from the first commit; Monaco models are disposed on tab close (no accumulation); the UI store validates
telemetry on rehydration (any non-`true` value → opt-out). **Noted for later** (real, not yet due): the
watcher's lifecycle is tied to workspace change, not window recreation (fine for the single-window app);
a tab whose file is deleted on disk keeps a stale model until closed (cosmetic).

**Environment note:** the `gitleaks` gate could not run — the binary is not installed on this machine.
A manual secret scan of the full M2 diff (tracked + untracked) found nothing but a package name and the
path-guard fuzz payloads (`etc/passwd`, `id_rsa` as _test strings_). The gate remains mandatory in CI.

### Launch fixes (reported black screen on startup)

Two launch-time defects were reported and fixed after the review, each reproduced and verified in the
running app:

| Symptom                          | Root cause                                                                                                                                                                                                                                                                  | Fix (verified)                                                                                                                                                                                                                             |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Black screen on launch**       | GPU compositing: on this Windows driver Chromium paints the DOM but never composites the first frame of a frameless, deferred-show window. `FIXORA_DEBUG` DOM probe showed `#root` fully populated (~12 KB HTML), no console errors — a compositing, not a render, failure. | `disable-gpu-compositing` on win32 (CPU composites, GPU still rasterises so Monaco stays fast). Verified via PrintWindow with **zero interaction** — the UI paints on a normal show, no resize needed. `FIXORA_DEBUG=1` diagnostics added. |
| **`pnpm dev` crash / no window** | An inherited `ELECTRON_RUN_AS_NODE=1` booted Electron as plain Node — `app` undefined — so main threw before any window painted.                                                                                                                                            | `pnpm dev`/`preview` run through a launcher that strips the variable. Verified the GUI starts with the variable set.                                                                                                                       |

---

## M1 acceptance criteria — verified, not asserted

The roadmap defines three. Each was checked against the running app, not just the source.

| Criterion (Roadmap M1)                                | Status | How it was verified                                                                                                                                                                                                                                                                                     |
| ----------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Every shell surface operable with the keyboard alone  | ✅     | ⌘K palette, theme toggle (Ctrl+Shift+L) and density toggle (Ctrl+Shift+D) all driven by keyboard in the running app (screenshots). Activity rail, tabs, select, dropdown, resize handles are Radix / library primitives with keyboard operation; arrow-key selection tested on Select and DropdownMenu. |
| axe-core reports zero critical violations             | ✅     | axe (critical **and** serious) asserts clean across the primitives including open Dialog, Select and DropdownMenu — the overlays where a11y actually breaks. Runs in the unit suite on every PR.                                                                                                        |
| Theme + density switch instantly with no layout shift | ✅     | Both are single root `data-*` attributes the token layer reads in CSS — no React re-render. Verified in the app: toggling to light + compact switched the whole UI at once (screenshot). No-layout-shift is structural: theme changes only colours; density is CSS-variable-driven.                     |

**M1 build stats:** 15 primitives + composites, the app shell, one command registry driving palette +
keybindings + hints, the IPC events layer, and Ladle. Tests **27 → 77**. Every CI gate green.

---

## M1 audit + red-team (2026-07-14) — passed

Per the standing instruction, an internal audit ran before marking M1 done and a red-team review before
requesting approval. Both found real issues; all fixed within M1, each with a test.

| Pass         | Finding                                                                                                                                                                                                                                                                             | Resolution                                                                                                                                                                                |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Audit**    | The global keybinding listener read a parallel props ref, not the command registry — so "one registry drives palette **and** keybindings" was only true by coincidence (both derived from the same prop).                                                                           | The listener now reads `registry.all()`. There is literally one source for both, which is the M1 thesis.                                                                                  |
| **Audit**    | `@radix-ui/react-popover` was declared but no component imported it.                                                                                                                                                                                                                | Removed (Standards §2). Returns with its component when M2+ needs it.                                                                                                                     |
| **Audit**    | Select / DropdownMenu / VirtualList had no direct tests.                                                                                                                                                                                                                            | Added axe + keyboard-operability tests (open state, arrow-key select) and a VirtualList windowing test.                                                                                   |
| **Red-team** | The Zustand store trusted whatever it rehydrated from localStorage. localStorage survives upgrades and a compromised renderer can write it, so a stale/tampered `activeView` flowing into `copy[activeView]` **crashes the app on launch** (violates DB §1 "degrade, never crash"). | A validating `merge` coerces every rehydrated value to the known-good set before it enters state. Proven with 5 tests (renamed view, tampered theme, corrupt layout, non-object payload). |

**Assessed and clean:** the preload `subscribe()` clamps to the event allowlist and never exposes
`ipcRenderer`; the emitter validates every event before send and skips destroyed windows; window controls
act only on the caller's own window (the M0 top-frame check still applies); drag regions and localStorage
carry no code or secrets. **Noted for later** (real, not yet due): `ipcRenderer` max-listeners under many
M5 subscriptions; command-vs-Monaco keybinding precedence in M2.

---

## M0 acceptance criteria — verified, not asserted

The roadmap defines three. Each was tested by making it fail first.

| Criterion (Roadmap M0)                               | Status | How it was verified                                                                                                                                                                                                                                                                  |
| ---------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm dev` opens a hardened window                   | ✅     | Built app launched; window titled "Fixora"; 4 Electron processes; the IPC round-trip returned real data (`version 0.1.0`, `electron 43.1.0`, `win32/x64`) rendered through the token layer. All 12 hardening flags confirmed present in the **shipped** bundle, not just the source. |
| `pnpm run ci` runs every gate green                  | ✅     | Full suite green: format · typecheck · lint (`--max-warnings 0`) · 55 unit tests · contrast · boundaries · ADR drift · Electronegativity · gitleaks · dependency audit (0 vulnerabilities).                                                                                          |
| A contrast violation in a token file fails the build | ✅     | Planted `#8b5cf6` (violet-500 — the shade a designer would reach for). Gate failed with `4.23:1, needs 4.5:1`; the unit test failed too. Reverted; green.                                                                                                                            |

**Also proven by planted failure:** the boundary gate (an `electron` import in `packages/shared-types` →
`error core-no-electron`) and the preload rule (a barrel value-import → refused; a type-only import →
allowed). Every gate in this repo has been watched failing. **A gate never seen fail is a hypothesis.**

---

## M0 red-team review (2026-07-14) — passed

Reviewed as a hostile competitor. One **critical foundational** hole, three smaller hardenings — all fixed
within M0, each with a fail-first test. Detail in [CHANGELOG.md](./CHANGELOG.md).

| Severity         | Vector                                                                                                                                                                                                                                                       | Resolution                                                                                                                                                                           |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Critical**     | The renderer navigation guard trusted **any `file:` URL** — local secrets, system files, and UNC paths (`file://attacker-host/x`) that make an outbound SMB/NTLM connection to an attacker's host. Not reachable in M0, but the exact boundary M2 relies on. | Path-boundary check confining production navigation to the renderer directory (`..` resolved, UNC rejected); dev allows no `file:`. Tested with real attack URLs, proven fail-first. |
| **Medium**       | `shell.openExternal` was scheme-gated only; Security §2 requires a **host** allowlist. A compromised renderer could launch a phishing page in the user's browser.                                                                                            | Allowlist: `fixora.dev` (+ subdomains) and `github.com`; suffix-tricks (`fixora.dev.attacker.com`) tested + blocked.                                                                 |
| Defense-in-depth | The IPC router ignored the sender frame.                                                                                                                                                                                                                     | Rejects any call from a non-top frame — insurance against a future CSP regression, on the boundary every channel inherits.                                                           |
| Maintainability  | A preload comment named the depcruise rule deleted in the audit.                                                                                                                                                                                             | Corrected to the gates that actually enforce it.                                                                                                                                     |

**Assessed and clean:** supply chain (only 4 runtime deps ship — react, react-dom, zod, our own; the ~800
lockfile entries are dev tooling that never reaches the binary), CSP, the preload (0.5 kB, zod-free), and
IPC payload validation. Architectural coupling is enforced by the boundary gates; the one real coupling
risk — a future feature-slice hairball — is an M1 concern already assigned to ESLint (dependency-cruiser
is blind to relative paths, documented).

---

## M0 audit (2026-07-13) — passed

Re-reviewed as an external Staff Engineer before starting M1. **Twelve issues found in code that had already
passed every gate**, all fixed within M0, each with a regression gate so the class cannot recur. Detail in
[CHANGELOG.md](./CHANGELOG.md); the reusable lessons are in [PROJECT_MEMORY.md](./PROJECT_MEMORY.md).

| Severity           | Finding                                                                                                                                                                                        | Resolution                                                                                                                                                  |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Security**       | The preload — the one privileged script in a sandboxed renderer — shipped **the whole zod library (120 kB of a 121 kB bundle)** to obtain a list of channel names.                             | Zod-free `@fixora/shared-types/channels` entry point. **Preload: 121 kB → 0.5 kB.** Enforced by an ESLint rule + a test that greps the shipped bundle.      |
| **Security**       | A declared-but-unhandled IPC channel returned a polite "try again" at runtime instead of failing the build.                                                                                    | `assertEveryChannelIsHandled()` at startup. A channel with no handler is a placeholder (Standards §2).                                                      |
| **Correctness**    | `theme.css` referenced a token that no longer existed, and status `onSolid` vars were camelCase → unreachable. The badge colour the contrast gate _proved_ was accessible rendered colourless. | Fixed; `css-consistency.test.ts` now asserts every referenced variable is defined and kebab-cased.                                                          |
| **Correctness**    | `duration-[--var]` (Tailwind v3 syntax) emitted invalid CSS — the button had no transition.                                                                                                    | Corrected to v4 `duration-(--var)`.                                                                                                                         |
| **Accessibility**  | `border.default` was commented "contrast-checked at 3:1" but was never gated, and would have failed.                                                                                           | Comments made honest. Per WCAG 1.4.11 the _identifying_ boundary is `border.strong` (gated, 3.29:1); a resting border below 3:1 is correct and intentional. |
| Maintainability    | `App.tsx` fetched inside a `useEffect` — violating Standards §3 verbatim.                                                                                                                      | Extracted to `useAppInfo`; the M1 TanStack Query swap now touches one hook.                                                                                 |
| Maintainability    | Errors advised "try again" for deterministic failures.                                                                                                                                         | Next steps are honest now (Standards §5: a wrong next step is worse than none).                                                                             |
| Maintainability    | Raw hex `#0b0a0f` in `main-window.ts`.                                                                                                                                                         | Now `dark.bg.canvas` — brand drift closed.                                                                                                                  |
| Dead code          | `ResultSchema`, `IPC_UNKNOWN_CHANNEL`, `focus.offset`, and the public re-export of the **raw colour ramps** (a footgun letting a component bypass the contrast gate).                          | Removed. Reaching past the semantic layer is now a resolution error.                                                                                        |
| Dependency bloat   | `zod` (unused) in `apps/desktop`; `vitest` (unused) at root.                                                                                                                                   | Removed.                                                                                                                                                    |
| Process            | `@changesets/cli` was installed but never configured, though Repo §3 mandates it.                                                                                                              | `.changeset/` configured.                                                                                                                                   |
| **Gate integrity** | The dependency-cruiser rule I first wrote to guard the preload **reported green while being blind** — it cannot resolve workspace subpaths.                                                    | Deleted and replaced with enforcement that actually sees the edge. A blind gate is worse than none.                                                         |

**Not changed, deliberately:** `.npmrc`'s `node-linker=isolated` / `hoist=false` (load-bearing — this is what
exposed the phantom dependency in the Electron scanner) and the renderer bundle at 546 kB (React + react-dom,
uncompressed; it is not a defect, and the size budget belongs to M8 where the installer is measured).

---

## What exists

```
fixora-desktop/                        (this repo)
├─ apps/desktop/          Electron shell + workspace/editor/persistence — path-guarded FS, node:sqlite,
│                         Monaco under strict CSP, file watcher, settings surface, typed IPC
├─ packages/ui/           @fixora/ui — Radix + CVA primitives (incl. Switch), tokens-driven
├─ packages/tokens/       @fixora/tokens — violet + neutral scales, light+dark, contrast gate
├─ packages/shared-types/ zod IPC contract registry, typed error union, Result
├─ tooling/               tsconfig · eslint-config · scripts (ADR sync, gate runners)
├─ docs/                  the blueprint (source of truth) + docs/adr/ (33 generated records)
└─ .github/workflows/     CI — every gate blocking
```

### Gates now blocking on every PR

| Gate                  | What it protects                                      | Enforced by                          |
| --------------------- | ----------------------------------------------------- | ------------------------------------ |
| typecheck             | `strict` + `noUncheckedIndexedAccess`, no `any`       | tsc 6.0.3                            |
| lint                  | Standards §1–§3, `--max-warnings 0`                   | ESLint 10 + typescript-eslint strict |
| unit tests            | 154 desktop + ui/tokens/shared-types suites           | Vitest 4                             |
| **contrast**          | WCAG 2.2 AA on 104 colour pairs, both themes          | `@fixora/tokens` gate                |
| **boundaries**        | **Invariant I1** — `core-*` never sees electron/react | dependency-cruiser + ESLint          |
| **ADR drift**         | One source of truth for decisions                     | `tooling/scripts/sync-adrs.ts`       |
| **Electronegativity** | Electron misconfiguration (Security §2)               | SARIF, uploaded to code scanning     |
| **gitleaks**          | Secrets, across full history                          | gitleaks 8.30                        |
| **audit**             | Supply chain (Security §7)                            | `pnpm audit --audit-level high`      |

---

## Deliberately NOT in M0, and why

These appear in the CI table of Repo §4 but belong to the milestone that creates the thing they test.
Building them now would mean building a gate around code that does not exist.

| Deferred                         | Arrives in     | Why not now                                                                                       |
| -------------------------------- | -------------- | ------------------------------------------------------------------------------------------------- |
| E2E (Playwright) + axe-core      | **M1**         | There is no shell to traverse and no component to audit.                                          |
| Secret-gate integration test     | **M5**         | The secret gate is part of `core-ai`. The _test_ is mandatory the day the gate exists.            |
| Golden corpus score              | **M5**         | Requires the AI layer and the verification engine.                                                |
| OpenAPI → TS client codegen diff | **M4**         | Requires the FastAPI service.                                                                     |
| `pip-audit`                      | **M4**         | No Python in this repo yet.                                                                       |
| Azure Trusted Signing            | 🔄 **started** | Identity validation begun 2026-07-13 (Packaging §2 — it takes weeks, so it starts in M0, not M8). |

---

## Open items

### 1. ✅ Restore `docs/` from your original copy — **done**

The 19 blueprint documents were restored and verified; `git diff --stat -- docs` is now empty. `docs/` is
permanently in `.prettierignore` so the M0 reformat cannot recur. `docs/adr/` remains generated.

### 2. ✅ Append ADR-029 / 030 / 031 to the register — **done**

Appended and regenerated. The register now holds **33 ADRs** through ADR-033 (`node:sqlite`), and
`pnpm gate:adr` is green (no drift).

### 3. 🔄 Azure Trusted Signing — **identity validation started 2026-07-13**

Packaging §2: start in M0, not M8. Validation takes days-to-weeks and it is the difference between
"Windows protected your PC" and a clean first install — the single biggest leak in the install funnel.
**Status: in progress.** Blocks M8; nothing before it.

---

## Known constraints discovered during M0

- **`pnpm ci` is now a built-in pnpm command** and shadows our script — it wipes `node_modules` and
  reinstalls. The gate suite is **`pnpm run ci`**. The roadmap's literal wording predates this.
- **Electron main/preload build as CommonJS**, not ESM. This is forced: Electron does not support an ESM
  preload in a sandboxed renderer, and `sandbox: true` is not negotiable (Security §2).
- **TypeScript is pinned to 6.0.3, not 7.x.** `typescript-eslint@8` peers `typescript <6.1.0`. Taking TS 7
  would silently disable the type-aware lint rules that Standards §1 makes mandatory.
- **dependency-cruiser cannot resolve `./x.js` → `./x.ts`.** All boundary rules are therefore written
  against package specifiers, which it _does_ resolve. Relative-path and cycle rules are owned by ESLint,
  whose TS resolver follows them. Documented in `.dependency-cruiser.cjs` so nobody later adds a
  relative-path rule there and believes it is running.
