# Changelog

All notable changes to Fixora. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Commits are [Conventional Commits](https://www.conventionalcommits.org/) — they generate this file, and
this file is a **product surface on the website** (Repo §3), not an afterthought.

## 1.2.14 (September 2, 2026)

### Fixes
- Preview now opens your running dev server correctly when switching to the Preview panel.
- Preview panel is hidden when switching to another panel and restored when you come back.
- Preview no longer times out when the dev server is already running on a common port.

## 1.2.13 (September 1, 2026)

### Features
- Packages panel now has a Scripts tab — run any package.json script with one click, using the right package manager automatically.
- The TypeScript language service now reads your project's tsconfig.json, giving you accurate completions, errors, and go-to-definition for your actual codebase.
- Code snippets: type rfc, useState, useEffect, fn, afn, trycatch, cl, interface, or type to expand common patterns instantly.
- Go to Definition, Find References, and Code Lens are enabled in the editor.
- Inlay hints show parameter names, variable types, and return types inline as you write code.
- Git blame for the current line now shows the author, relative time, and commit summary. Use the status bar to toggle it on or off.
- Update downloads show as an animated progress bar under the title bar.

### Fixes
- Preview detects your dev server port faster by reading its output directly.
- Preview stops the running dev server when you open a different project.
- The problems list no longer remounts while analysis results are streaming in.

## 1.2.12 (September 1, 2026)

### Fixes
- Preview: dev server now launches correctly on Windows.
- Preview: port detection is faster after server starts.
- Tooltips across the app now share consistent hover-delay behavior.

## 1.2.11 (September 1, 2026)

### Features
- Preview: clicking "Open Preview" now launches your dev server in the background and opens your project directly inside Fixora — no terminal required.

### Fixes
- Git Bash now appears in the terminal shell picker when installed in Program Files.

## 1.2.10 (August 31, 2026)

### Fixes
- Git Bash now appears in the terminal shell picker on Windows.
- Problems panel rows no longer collapse or overlap after a repair is applied.

## 1.2.9 (August 31, 2026)

### Features
- Live Preview: detects your running dev server automatically and opens it in an integrated browser panel.
- Live Preview: auto-refreshes when you save a file.
- Live Preview: start your dev server directly from the Preview panel or Problems panel without opening a terminal.
- Editor: word wrap, indent guides, whitespace rendering, smooth scrolling, cursor style, cursor blinking, font size, and tab size are now configurable in Settings.
- File tree: language-specific file icons for TypeScript, JavaScript, Python, CSS, HTML, JSON, Markdown, and Git files.
- Status bar: word wrap toggle and tab size indicator.

### Fixes
- Problems panel rows remain stable during analysis and after repairs.
- Scroll position is preserved when findings update.

## 1.2.8 (August 30, 2026)

### Features
- Referral program: share your personal code and both parties receive bonus repairs.
- Bonus repairs from referrals now persist across sessions.

### Fixes
- Problems panel rows no longer overlap or misalign with large finding lists.
- App now starts faster after installing an update.
- Fixora icon now appears correctly in the Windows taskbar and Task Manager.

## [1.2.4] — 2026-08-28

### ✨ New Features
- **Git:** Push, Pull, Fetch buttons in Source Control panel
- **Git:** Branch switcher — click branch name to switch branches
- **Git Diff:** Click any file in Source Control to see Monaco-powered diff
- **.fixoraignore:** Custom per-project analysis ignore rules (gitignore syntax)
- **Panel Toggle:** Ctrl+B / Ctrl+J — hide/show sidebar and AI panel
- **Title Bar:** Dedicated sidebar + AI panel toggle buttons with proper icons
- **Search:** Case sensitive, regex mode, file filter, find and replace (Mod+Shift+F)
- **Editor:** Inlay hints, bracket pair colorization, parameter hints
- **Editor Themes:** Dracula, GitHub Dark, One Dark added (6 themes total)
- **Command Palette:** Git commands, theme switching, recent commands history

### 🐛 Bug Fixes
- **Editor Themes:** Fixed "Illegal theme name" crash when switching themes
- **Problems Panel:** Findings no longer overlap (entrance animation fix)
- **Icons:** Proper sidebar, push, pull, fetch icons throughout

## [1.2.3] — 2026-08-27

### ✨ New Features
- **MCP:** Rate limiter added (matches IPC limits — prevents abuse)
- **MCP:** "Restart required" badge when toggling MCP in settings

### 🐛 Bug Fixes
- **Problems Panel:** Toolbar buttons no longer cut off on narrow panels
- **Problems Panel:** Banner stack height capped — findings list always visible
- **Explain:** Text and follow-up responses now selectable/copyable
- **Azure:** Deployment name placeholder + helper text in provider settings
- **Startup:** Splash screen 2s minimum display time

### 🔒 Security
- **OAuth:** Replaced implicit flow with PKCE + loopback HTTP (RFC 8252) — session fixation gap closed
- **Repair Limit:** Migrated from repair-count.json to SQLite — concurrent write race fixed
- **Repair Limit:** SQLite WAL mode ensures safe concurrent access (GUI + MCP standalone)
- **MCP:** Rate limiter prevents per-minute abuse (paywall already enforced)

### 🧪 Tests
- **MCP Server:** 17 new tests — JSON-RPC protocol, rate limiting, tool dispatch (1228 total)

### ⚠️ Known Limitations
- Windows binary unsigned (code signing pending)
- fixora:// protocol hijackable without code signing

## [1.2.2] — 2026-08-26

### ✨ New Features
- **File Tree:** File search bar, severity dot shows finding count on hover
- **Editor:** Ctrl+\ split view, tab search for 5+ tabs, Reveal in Terminal from context menu
- **Terminal:** Tab rename on double-click
- **History Panel:** Revert repair, search/filter, export as JSON/CSV
- **Problems Panel:** Skipped files banner, export findings, issue count in group headers, Watch Mode pill
- **Settings:** Test connection for providers, Reset to defaults, account section, settings search
- **Proceed Mode:** Instruction templates, instruction history (↑ arrow)
- **Status Bar:** Real encoding display, findings count pill, analysis file count
- **Upgrade Dialog:** Plan comparison with direct upgrade links
- **Onboarding:** Step progress saved, Replay Tour in Settings, Escape confirmation

### 🐛 Bug Fixes
- **Startup:** Fixed critical startup race — pull-based polling replaces push-based app:ready
- **Startup:** Splash screen minimum 2s display time added
- **Startup:** ai:getConfig no longer races handler registration
- **Splash Screen:** 30s timeout + error state if backend genuinely hangs
- **License:** Removed double repair counting
- **Proceed Mode:** Repair limit enforced (paywall bypass fixed)
- **Proceed Mode:** Removed debug diagnostic code from production
- **Auth:** Sign out confirmation, user info in Settings
- **Workspace:** Large project warning at 10,000+ files

### 🔒 Security
- **Proceed Mode:** Repair limit paywall enforced (critical fix)
- **License:** Main process is now sole authority for repair counting

### 🧪 Tests
- **Code Shield:** 30 new tests added (1211 total)

### ⚠️ Known Limitations
- Windows binary unsigned (code signing pending)
- OAuth session fixation gap (PKCE refactor deferred)
- Azure model picker empty (fix pending)
- repair-count.json race condition with MCP standalone (SQLite migration pending)

## [1.2.1] — 2026-08-25

### ✨ New Features
- **Update Notifications:** Instant status bar pill when update is ready — "🔄 v1.2.1 ready" with one-click restart
- **What's New Modal:** Changelog now shows automatically after update restart, not before

### 🐛 Bug Fixes
- **VS Code Extension:** `Fixora: Analyze` always reported "0 issues" in MCP mode — fixed via new `mcp:analyzeFile` channel with proper `file` parameter
- **VS Code Extension:** `Fixora: Repair` and `Fixora: Explain` now work standalone (BYOK) without Fixora Desktop

### ⚡ Performance
- Lazy-load WorkspacePanel, FindingsPanel, HistoryPanel, SettingsPanel — faster startup
- Conditionally mount dialogs — reduced memory usage when idle

### 🌐 Website
- Added `sitemap.xml`, `robots.txt`, `manifest.json` for SEO
- Google Search Console verified and sitemap submitted

### ⚠️ Known Limitations
- Code Shield has no automated test coverage
- Proceed Mode repair limit not enforced (pre-existing)
- Windows binary unsigned (code signing pending)

## v1.2.0 — Code Shield & VS Code Extension

_Released August 24, 2026_

### 🛡️ Code Shield — Your Personal Senior Engineer

The most significant feature in Fixora's history. Code Shield analyzes every file you open and gives you a real-time quality score — like having a senior engineer review your code before every commit.

- **PR Readiness Score (0–100)** — know exactly when your code is merge-ready
- **Three readiness states** — Ready ✅, Needs Work ⚠️, Not Ready ❌
- **Specific senior advice** — plain English guidance tied to your actual code
- **Auto-Fix** for deterministic issues — one click, done
- **Smart file detection** — never scores files it can't actually analyze
- **30-second timeout protection** — never hangs on large or complex files
- **Three sensitivity levels** — Strict, Balanced, Relaxed
- **Status bar integration** — 🛡️ score always visible, click to open panel
- **On by default** — toggle off anytime in Settings

### 🔌 VS Code Extension — Now Truly Standalone

- **No desktop app required** — works with your own API key
- **Supports OpenAI, Anthropic, Gemini, OpenRouter**
- **Inline diagnostics** — issues appear as squiggly lines in your editor
- **First-time setup wizard** — guided API key configuration
- **Available on VS Code Marketplace** — search "Fixora"

### 🤖 GitHub PR Integration

- Automatically analyzes every pull request in your repo
- Posts a clean issue table as a PR comment, updates on each push
- Zero configuration — copy one workflow file to get started

### ✨ Polish & Developer Experience

- Onboarding tour for first-time users
- Keyboard shortcuts panel (press ? anywhere)
- Repair stats in the status bar (⚡ X fixed today)
- Full repair history with forced-apply tracking
- Share repairs on Twitter/X, "Fixed by Fixora" README badge

### 🐛 Bug Fixes

- Fixed Code Shield showing fabricated scores for non-code files
- Fixed silent analysis failures producing incorrect scores
- Fixed cross-workspace cache collision showing the wrong project's score
- Fixed stale score displayed during file switching
- Fixed settings race condition on first file open

### ⚠️ Known Limitations

- Windows binary is not yet code-signed (SmartScreen warning on first install)

## v1.1.9 — Polish & Power Features

_Released August 24, 2026_

### ✨ New Features

#### 🎓 Onboarding Experience
- First-time users see a guided 5-step welcome tour
- Empty states throughout the app — no more blank screens
- Clear guidance on how to open projects, analyze, and repair

#### ⌨️ Keyboard Shortcuts Panel
- Press ? anywhere to see all keyboard shortcuts
- Grouped by Navigation, Analysis, Editor, AI Features
- Clean, searchable reference panel

#### 🏅 "Fixed by Fixora" Badge
- Add a badge to your README after fixing bugs
- Share your fix on Twitter/X with one click
- Badge appears after every 5th successful repair

#### 📊 Repair Stats
- Status bar shows "⚡ X fixed today"
- Hover to see all-time repair count
- Updates live after every repair

#### 📋 Repair History Improvements
- "Forced" badge on repairs applied without verification
- Per-file repair history (available via API)
- was_forced flag tracked in database

### 🔌 VS Code Extension (Beta)
- Install from GitHub Releases (.vsix file)
- Analyze current file from VS Code
- Powered by Fixora's MCP server

## v1.1.8 — Feedback, Smarter Explain & Polish

_Released August 24, 2026_

### ✨ New Features

#### 💬 User Feedback System
- Rate your experience after your first few repairs (1–5 stars)
- Share optional comments to help us improve
- Opt-in to have your feedback shown on the Fixora website
- "Maybe Later" snoozes the prompt — never shown again after you submit

#### 🌐 Public Feedback Wall
- Visit fixora-opal.vercel.app/feedback.html to see shared feedback
- Only feedback you explicitly opt to share appears publicly

#### 💡 Explain — Follow-up Chat
- Ask follow-up questions after any explanation
- AI answers in simple, beginner-friendly language
- Every answer is grounded in your actual code — no generic responses
- Up to 10 follow-up questions per session, completely free

### 🔒 Security & Reliability
- File encoding now detected and preserved on every repair (UTF-8, UTF-16, Latin-1)
- Gumroad licenses re-verified every 24 hours — refunded keys automatically revoked
- MCP Server now works alongside a running Fixora instance (standalone mode)
- Privacy policy updated to accurately disclose all data collection

### 🐛 Bug Fixes
- Fixed Windows Start Menu showing "Electron" instead of "Fixora"
- Fixed app executable metadata (version, company name, description)
- Fixed problem card text overlapping during repair state transitions

### ⚠️ Known Limitations
- Windows binary is not yet code-signed (SmartScreen warning on first install — click "More info → Run anyway")

## v1.1.7 — Smarter, Safer, More Informative

_Released August 23, 2026_

### ✨ New Features

#### 🔔 Notification System

- In-app toast notifications for all key actions (repair success, failures, limit warnings, updates)
- OS-level notifications when Fixora is in the background (Watch Mode, updates, limit reached)
- Notifications stack cleanly — max 3 visible at once, queued automatically

#### 💡 Explain Feature (Now Live)

- "Explain" is no longer marked "soon" — it's fully live
- AI explains any error or warning in plain, beginner-friendly language
- Uses real-world analogies so anyone can understand what went wrong
- Structured format: What's wrong → Why it matters → How to fix it → Example
- Free to use — does not consume your repair limit

#### 🔌 MCP Server — Standalone Mode

- MCP server now works independently alongside a running Fixora instance
- Launch with `Fixora.exe --mcp` — no conflict with the main app
- Enables Claude Desktop and other MCP clients to use Fixora simultaneously

#### 🌐 File Encoding Detection

- Fixora now detects and preserves file encoding on every repair
- Supports UTF-8, UTF-16 LE/BE, and Latin-1 — no more file corruption
- BOM (byte order mark) preserved automatically
- Subtle encoding badge shown in editor for non-UTF-8 files

### 🔒 Security & Reliability

#### License Re-Validation

- GO and PRO licenses are now re-verified with Gumroad every 24 hours
- Refunded or cancelled subscriptions are automatically moved to free tier
- Network errors and timeouts never downgrade a paying customer

### 🐛 Bug Fixes

- Fixed problem card text overlapping during repair state transitions
- Fixed MCP server failing to start when Fixora was already running

### ⚠️ Known Limitations

- Windows binary is not yet code-signed (SmartScreen warning on first install)
- MCP repair limit metering may be slightly imprecise when both app and MCP run simultaneously

## v1.1.6 — Security & Reliability Update

_Released August 23, 2026_

### 🔒 Security

- Repair limit enforcement moved to main process — no longer bypassable via browser tools
- File backup created before every AI repair — your code is safe even if something goes wrong
- Cookie consent banner added — analytics only load after you opt in (GDPR compliant)
- MCP Server is now off by default — requires explicit opt-in in Settings
- IPC rate limiting added to prevent abuse (10 repairs/min, 5 terminals/min)
- OAuth login hardened with duplicate-callback protection

### 🐛 Bug Fixes

- Fixed app freezing when opening large projects (50k+ files)
- Fixed repair limit not resetting after 3 hours
- Fixed countdown timer showing "NaN" in some cases
- Fixed repair count showing stale data after limit reset
- Fixed GitHub OAuth login failing on re-login without restart
- Fixed cascading repair dialog disappearing when panel was closed
- Fixed Google Analytics loading before cookie consent

### ✨ Improvements

- Repair limit now resets every 3 hours (previously daily)
- Countdown timer shows exact time remaining: "Resets in 2h 34m"
- App name now shows "Fixora" in Windows Task Manager
- Added refund policy page to website
- Added Monaco Editor and Electron attribution in Settings → About
- MCP Server status indicator in status bar when active
- Warning-severity issues now included in Group Repair
- Harmful fix detection: risky repairs flagged before applying

### ⚠️ Known Limitations

- Windows binary is not yet code-signed (SmartScreen warning on first install — click "More info →
  Run anyway")
- MCP Server works best when launched standalone via `--mcp` flag

## [Unreleased]

Built on `sprint-1/ui-stability`, after the `v0.9.0-beta.1` tag below. Not released; no installer,
Stripe, or publish step has been performed for any of this.

### Added

- **Proceed Mode** — a second editing pipeline alongside Repair: a natural-language instruction is
  turned into a VERIFIED edit proposal (deterministic intent classification, AST scope detection,
  context/prompt construction reusing the repair budget + secret gate, and the same verification engine
  Repair uses — `computeVerdict` extended with an edit-mode branch rather than forked). Ships with
  preview → Accept/Cancel, Retry on a retryable provider failure, and real in-flight Cancel.
- Repair and Proceed failure UX brought to parity: a `retryable` classification is now surfaced
  consistently in both panels' Retry affordance.
- A permanent write-verification invariant: `writeTextFile` (the one function Repair's apply, Proceed's
  Accept, and manual Save all go through) now reads every write back and refuses — with a clear,
  actionable error — if the on-disk bytes don't match what was intended, instead of silently reporting
  success.
- **Welcome Experience (Sprint F2).** A premium first-run/startup surface: the splash screen's
  minimum-visible time is now bounded at ~1.8s — just long enough for the staggered logo/wordmark
  entrance animation to finish playing, never a multi-second "premium" wait manufactured on top of
  that — and its loading indicator disappears the instant initialization actually resolves, even
  during that brief remainder. The Home screen (shown whenever no project is open) gains a **Quick
  Actions** row (Open folder, Open recent, Documentation, What's New — the latter two as in-app
  dialogs, no network required) and **pin support** for Recent Projects (a pinned project sorts to
  the top; migration v6 adds `workspaces.pinned_at`, a new `workspace:setPinned` IPC channel).
- **Suggestion System (Sprint F1) — COMPLETE.** A local-first feedback channel: category selector,
  auto-resizing message editor with a character counter, validation, submit loading state, a
  thank-you confirmation, SQLite-backed history, and export to JSON. Two ways to send a suggestion to
  Fixora: **Email to Fixora** (a pure `buildShareEmail()` formatter + a reusable, cross-platform
  `MailService` that pre-checks for a registered `mailto:` handler before ever calling
  `shell.openExternal`) and, when no mail client is detected, a **Gmail Web fallback** dialog (Open
  Gmail / Copy Email Address / Copy Subject / Copy Message). The email body includes the category,
  message, app version, OS, the current **workspace name** (or `Workspace: None`), and a
  **timestamp**.

### Fixed

- **Licensing (beta audit A10 — closed, no fix required). Beta Readiness Audit series (A1–A10)
  now COMPLETE.** A full engineering audit of the offline Ed25519 license verification, activation/
  deactivation flow, Stripe entitlement fulfilment, and tamper resistance found zero genuine beta
  blockers: entitlement is re-verified from the signed key on every read (never a cached boolean),
  the private signing key has never existed in this repository (confirmed via full git history), and
  a tampered, wrong-key-signed, expired, or malformed license is correctly rejected and tested. No
  feature is functionally gated on this entitlement in the beta. Non-blocking/technical-debt/
  test-coverage findings (no confirmation before deactivating; a file-write error path lacking its
  own `UserFacingError`; a non-atomic but safely-degrading credentials write; offline expiry's
  inherent clock-skew exposure; no revocation mechanism; no IPC-handler/store/component test
  coverage) are deferred post-beta per instruction. This closes the originally planned A1–A10 Beta
  Readiness Audit series in its entirety — every audited module shipped with zero blockers remaining.
- **Repair History Panel (beta audit A9 remediation).** "Re-run repair" is no longer offered for a
  Proceed-sourced history entry. Since Proceed edits started recording into the same repair history
  (audit A6), a Proceed row has no real analyzer finding behind it (`source: 'proceed'`, a synthetic
  `findingId`) — re-running it always failed and showed "That finding is no longer available.", which
  falsely implied the finding used to exist. `HistoryRow` now checks `entry.source` and omits that
  action for those rows; "Open result" and "Copy repaired code" are unaffected. No change to the diff
  view gap, delete/clear error handling, the 200-row history cap, or `VirtualList` migration — all
  explicitly deferred.
- **Settings & AI Configuration (beta audit A8 — closed, no fix required).** A full engineering
  audit of the API-key storage/retrieval/settings surface found zero genuine beta blockers: the key
  is genuinely encrypted at rest via Electron's OS-level `safeStorage`, the app refuses to store the
  key at all (never falls back to plaintext) when OS encryption is unavailable, and the key never
  crosses IPC to the renderer or appears in any log. Non-blocking/technical-debt/test-coverage
  findings (a decrypt failure reading the same as "never configured," no client-side key-format
  validation, an in-flight request not cancelled on key clear, `setKey`/`clearKey`/`setModel` lacking
  their own `UserFacingError` wrapper, a non-atomic credentials-file write, and — most notably — zero
  regression test coverage on the `keychain_unavailable` refusal path) are deferred post-beta per
  instruction; nothing in this feature changed.
- **Suggestion System (beta audit A7 — closed, no fix required).** A full engineering audit found
  zero genuine beta blockers — no data-loss, correctness, or trust problem affecting the user's
  actual project. Non-blocking findings (a renderer/main max-length validation disagreement, no
  total mailto-URL length guard, no secret-scanning safeguard on suggestion text, no
  browser-presence pre-check on the Gmail Web fallback, a 500-row cap on history/export with no
  retention policy) are deferred post-beta per instruction; nothing in this feature changed.
- **Proceed Mode (beta audit A6 remediation).** Proceed edits are now recorded in the same
  `RepairHistoryRepository` audit trail Repair writes to — whatever the verdict, mirroring Repair's
  "an unresolved or regressed attempt is part of the history too" discipline — closing a real gap
  given Proceed shares Repair's write path and BUG-002's still-open data-integrity risk. The
  `proceed:run` unhandled-exception path no longer leaks a raw JS error message to the renderer; it
  now reuses the same `describeRunFailure()` wording Repair's `ai:run` guarantees (an authored error
  verbatim, anything else an actionable, non-generic sentence). No change to intent classification,
  scope resolution, verification, or the apply path.
- **Repair Engine (beta audit A5 remediation).** The "Verified" verdict's language no longer reads
  as a whole-project guarantee. Verification re-analyzes only the single file a repair changes — a
  fix that breaks a caller in a different file could still show as "Verified" — and the copy
  ("nothing new broke") didn't disclose that scope. Every place the claim reaches the user (the
  verdict banner, the Apply-gate explanation, the user guide) now names the file explicitly
  ("re-run against this file... found no new problems in it"), with no change to what verification
  actually checks or how Apply is gated.
- **Problems Panel (beta audit A4 remediation).** A failed analysis run now shows a dedicated
  "Analysis failed" banner with the real error and a "Try again" button, instead of silently
  falling through to a generic empty state or leaving a previous run's now-stale findings on
  screen with no indication anything went wrong. The findings list gets the same keyboard fix
  already applied to the file tree (audit A2): Enter/Space now activate the keyboard-roving row,
  and rows are no longer individually tabbable. A "Showing N of M problems" disclosure now appears
  whenever the backend's 500-row cap truncates a result set, so the displayed count can never
  silently disagree with what the list actually shows.
- **File Explorer & Workspace (beta audit A2 remediation).** Switching workspaces — via Recent
  Projects, Quick Actions, the Open menu's "Recent" list, reopen-last, or the command palette — no
  longer silently discards unsaved editor changes; every switch path now shares the same
  unsaved-changes confirmation "Close folder" already had (`WorkspaceSwitchGuard`, gated centrally
  in `useWorkspaceStore`). The file tree's `listbox`/`option` ARIA roles now have real keyboard
  support (Arrow Up/Down, Home/End, Enter/Space, scroll-into-view, a roving
  `aria-activedescendant`) — previously advertised but unimplemented. Opening a Recent Project whose
  folder was deleted, moved, or renamed now shows a precise "no longer exists" message instead of
  the generic "Something went wrong," reusing the existing fs-error translation layer. An empty
  workspace (or one where everything is `.gitignore`d) now shows an explicit empty state instead of
  a blank pane, and expanding a directory shows a loading indicator instead of no feedback at all.
- Four confirmed defects in Proceed Mode, found by a full pipeline audit (Q3): a question-style
  instruction ("explain what this does") no longer reaches the AI provider as if it were an edit
  request; a pending preview is invalidated the instant the active tab changes away from the file it
  targets; Retry now replays the exact failed request instead of re-deriving one from whatever the
  cursor/tab happens to be at retry-time; a real Cancel action now aborts the in-flight request rather
  than only resetting local UI state.
- Four confirmed Analyzer defects (Q1): complexity scoring for callbacks/object methods and else-if
  chains, a JSON trailing-comma error location, and `memo()`/`forwardRef()`-wrapped component symbol
  resolution.
- A Repair reliability defect (Q2): deterministic (`safe-auto`) repairs were silently routed through the
  AI pipeline instead of the existing, already-tested `deterministicRepair()` — now routed correctly
  through a worker job mirroring the existing scope-resolution pattern.
- **BUG-F1-EMAIL-001** — "Email to Fixora" did nothing (no mail client opened, no error, no feedback).
  Two compounding causes: `shell.openExternal` was called with `void` (a rejection was silently
  discarded), and even once awaited, `shell.openExternal` can *resolve* with nothing actually opening.
  Fixed by awaiting/rethrowing plus a pre-send handler-presence check (Windows registry / macOS
  LaunchServices / Linux xdg-mime) that reports `no_mail_client` before ever calling
  `shell.openExternal`.
- Navigation rail category labels no longer clip (`leading-none` → `leading-tight`).

### Known issues

- **Unresolved, non-reproducible data-integrity incident (tracked, not blocking).** A file was reduced
  to all-zero bytes once during manual testing of Proceed's Accept path; extensive investigation (8
  varied controlled reproduction attempts, an antivirus history check, a process-tree audit) could not
  reproduce it or identify a cause. The write-verification invariant above guards against a recurrence
  ever being silent, but the root cause itself remains unknown. See `docs/BUGLOG.md` BUG-002.
- A background test (`acceptance-scale.test.ts`) intermittently times out only under full-suite parallel
  load on one dev machine; passes cleanly in isolation every time. Test-infrastructure item, not an
  application defect. See `docs/BUGLOG.md` BUG-003.

## [0.9.0-beta.1] — 2026-07-18 — Public Beta 🎉

The first Public Beta: **Verified AI Code Repair**, bring-your-own-key. Open a repo, run your own
analyzers, and let AI fix a finding — every repair is verified against your tools on a throwaway copy
before you apply it, and your code never leaves your machine except the provider call you choose.
`pnpm run ci` green: 323 tests + contrast, boundaries, ADR, electronegativity, gitleaks, and audit gates.

### Release preparation (2026-07-18)

- **Packaging** — electron-builder (NSIS, unsigned beta) with the ESM+WASM worker asar-unpacked, plus a
  `prepackage` step that vendors `@fixora/core-analysis` into the app as a real dir (pnpm's isolated
  linker symlinks it outside the app dir, which electron-builder's asar packer rejects). `docs/PACKAGING.md`.
- **Website** — a static download + trust page (`website/`): the verified-repair story, privacy claims as
  testable statements, Free/Supporter pricing, email capture, `privacy.html`, and `security.txt`.
- **Docs** — `docs/USER-GUIDE.md` (install → BYOK → analyze → verified repair → history → privacy) and a
  beta-user section in the README.

### Licensing — BYOK-free, offline Pro (2026-07-18)

Revenue at launch with no billing backend. BYOK is fully free; a one-time **Supporter/Pro** license is an
**Ed25519-signed token verified entirely offline** (no license server, nothing calls home). Modelled as a
generic entitlement the app reads, so v1.1's managed tier swaps the issuer, not the reader (ADR-036/038).

- Offline verifier (`node:crypto` Ed25519) + license service (activate / deactivate / persist), read as a
  `LicenseStatus`. Settings → License to paste + activate a key; the key never crosses back out.
- Owner tooling: `license-keygen.mjs` (one-time keypair; private key stays offline) and `sign-license.mjs`
  (mint a key per Stripe purchase). The app ships with an **empty** public-key slot and honestly reports
  "licensing isn't enabled" until the owner provisions one — the production signing key is never in the repo.
- Setup + fulfilment flow: `docs/LICENSING.md`.
- Verified: 9 tests — genuine sign→verify round-trip accepted; tampered payload, wrong key, expired, and
  malformed all rejected; service activates/persists/deactivates and never stores an invalid key.

### Mission pivot → BYOK Public Beta (2026-07-16)

Reprioritised to ship a stable, trustworthy **BYOK Public Beta**. The beta runs AI desktop→provider
direct (OpenRouter first) with the user's own key — no account, no server on the AI path. The managed
backend (`fixora-api`) and desktop sign-in are deferred to v1.1 (built and green; nothing wasted).

### Beta-M5 — Verified AI Repair, BYOK (2026-07-17)

The product: a grounded, gated, **verified** repair loop with bring-your-own-key.

#### Added

- **`@fixora/core-ai`** — pure-TS AI layer. The **secret gate** (the single outbound choke point, fails
  closed: path denylist + known-key patterns + entropy backstop; names the file+rule, never carries the
  secret); the **provider abstraction** with the **OpenRouter** BYOK adapter (SSE, JSON-schema output,
  retryable-vs-terminal errors, abort=cancel); the **context builder** (reuses the M3 engine — target =
  whole enclosing symbol, evidence = the deterministic finding, token budgeter drops neighbours whole);
  **task profiles** repair/explain/test with strict output parsing + one re-ask.
- **BYOK key store** — the OpenRouter key encrypted with the OS keychain (`safeStorage`/DPAPI); only a
  hint + model ever cross IPC, never the key. Settings → AI UI to set/remove the key and pick a model.
- **AI runs** — grounded on a stored finding, gated before any provider call, streamed to the panel;
  per-finding Explain / Repair / Test actions.
- **Verified repair (ADR-003)** — a proposed fix is applied to a throwaway **overlay** (source copied,
  `node_modules` junction-linked; the real files are never touched), the analyzers + a tree-sitter syntax
  check re-run on that one file, and the result becomes a verdict: **VERIFIED** (target resolved, nothing
  new), **REGRESSION** (broke syntax or introduced a finding — Apply is disabled), or **UNRESOLVED**.
  Tiered + honest: the report says which checks ran. A Monaco **diff viewer** with **Apply / Copy /
  Reject**; Apply splices the verified code through the same path guard reads use.
- **Repair history (audit trail)** — every reviewed repair is recorded in local SQLite (migration v4)
  with its verdict, the model, the before/after code, and whether it was applied. A **History** panel
  in the activity rail lists them newest-first with the verdict badge and an "applied" marker;
  click-to-open jumps to the file. Local and private — the inspectable record of what the AI proposed
  and what you accepted. The AI result panel also moved into its own workbench pane.

#### Verified

- 185 desktop tests + 62 package tests pass (zero regression). Live: `safeStorage` DPAPI round-trip; the
  verification worker producing a real syntax verdict (valid→ok, broken→regression) over a real overlay.

#### Phase F — acceptance, audit, red-team (2026-07-18)

- **Real over-HTTP acceptance** — a local OpenRouter-compatible SSE server drives the real adapter over a
  real socket through the whole pipeline (gate → stream → schema-parse). Only a real LLM's answer quality
  is left to the owner's own-key run (procedure in `docs/BETA-ACCEPTANCE.md`).
- **Audit fix (A1): stale apply.** `ai:applyRepair` now carries the original text the target range held at
  proposal time and **refuses to apply if the file changed since** — a repair is never spliced into code it
  was not computed against. Red-teamed.
- **Red-team of the write path** — `ai:applyRepair` refuses path traversal, refuses to write over a secret
  (`.env`), and refuses a stale apply; a fresh apply writes only the target range and records history.
- **ADR-036** (BYOK-first beta, managed tier deferred), **ADR-037** (repair emits a replacement symbol; we
  derive the diff + apply by verified range, refining ADR-013), **ADR-038** (local repair-history audit
  trail). `pnpm gate:adr` in sync.

### M3 — Deterministic analysis engine (2026-07-16)

The moat, and it contains **zero AI** (ADR-002): findings come from tree-sitter and the workspace's own
linters/type-checkers, each with a rule id, a location, and evidence. Fixora is genuinely useful here with
the LLM switched off.

#### Added

- **`@fixora/core-analysis`** — a pure-TS engine (no Electron/React, boundary-gated; runs in a CLI, a CI
  action, and the test harness): the unified `Finding` model (stable-across-runs id that survives a patch
  shifting lines); tree-sitter via WASM (ADR-034) for TypeScript/JavaScript, Python and Go — symbol
  extraction, imports, and a within-file call graph, with per-language conformance tests; **seven analyzers**
  behind one interface — complexity (cyclomatic + cognitive, tree-sitter, always on) and adapters for the
  workspace's own **eslint, tsc, ruff, mypy, go vet, Semgrep**; capability detection; and a no-shell
  subprocess runner (args as an array — command-injection defence).
- **Findings persistence** — SQLite migration v3 + a findings repository (per-file replace, grouped summary in
  SQL), so the panel loads instantly and survives a restart.
- **Isolated analysis** (ADR-017) — an ESM utility-process worker runs the engine; main vets which files it
  may read and manages its lifecycle (one job at a time, hard timeout, cancel, kill+restart on crash). A
  runaway parse or wedged tool degrades one panel, never the editor.
- **Findings panel** — virtualised, severity-filterable, backed by the persisted store; clicking a finding
  opens its file at the location. Streaming IPC (`analysis:run/cancel/list/summary` + `analysis:findingsAdded`
  / `analysis:state`), zod-validated both directions.
- **Live acceptance** — a test runs the real eslint subprocess over a fixture and asserts the adapter yields
  exactly eslint's own violations, grounded. Verified in the running app on a real JSX project: a real
  `cyclomatic-complexity` finding, rendered and click-to-open.

#### Fixed (M3 audit + red-team, before requesting approval)

- **Analyzers run once per workspace, not per file** (ADR-035). Project-scoped tools (`tsc`/`mypy`/`go vet`)
  were re-running the whole type-checker/vet for every file — O(files × project), unusable on a real repo.
  Each tool now spawns once (`eslint .`, `tsc --noEmit`, `go vet ./...`, …) and findings are distributed by
  file; complexity iterates files in tree-sitter. This is also what makes findings **match the user's CI** —
  it is the same single invocation they run.
- **`tree-sitter-wasms` is a runtime dependency**, not dev — the worker loads its grammar `.wasm` at runtime,
  so a production install must include it.
- **`pnpm dev` no longer black-screens.** `electron-vite dev` serves the renderer from the Vite dev server,
  where `@vitejs/plugin-react` injects an inline Fast-Refresh preamble that the strict CSP (`script-src
  'self'`) blocked — so React never mounted. Fixed with a dev CSP **nonce** (Vite `html.cspNonce`; a nonce is
  not `'unsafe-inline'`, ADR-006 holds) and stripping the static `<meta>` CSP in the dev server only.
  Production CSP unchanged. (The built app rendered all along, which is why this hid until dev was verified.)
- **Main must not import the ESM engine.** Main is CJS; importing `@fixora/core-analysis` threw
  `ERR_PACKAGE_PATH_NOT_EXPORTED` at startup. The engine belongs in the isolated worker anyway — main now
  imports none of it and enumerates targets with the desktop's own language helper.

### M2 — Workspace, editor, local persistence (2026-07-15)

The shell opens a real folder now: a file tree, a working editor, and persistence that survives a
restart — all offline, signed-out, and confined to the workspace. This is where the local-first moat
starts to matter.

#### Added

- **Local persistence on `node:sqlite`** (ADR-033, amends ADR-011) — Electron 43's built-in SQLite,
  chosen because better-sqlite3 has no prebuild for ABI v148 and no compiler is available; wrapped
  behind a `SqliteDriver` interface so the engine is swappable. WAL mode, foreign keys, forward-only
  numbered migrations (each transactional, backup-first), and repositories as the only code that writes
  SQL. A corrupt database **quarantines and starts fresh** rather than blocking launch (DB §1).
- **Path-guarded filesystem service** (Security §3) — every path is resolved through `realpath`
  (following symlinks/junctions/UNC) and checked on a **path-segment boundary**, never a string prefix;
  fuzz-tested with 500 generated traversals. A **secrets denylist** blocks `.ssh`, `.env*`, `*.pem`,
  `id_rsa`, `.git/config` and friends from ever being read into the app. Files over 8 MB are refused.
- **Workspace service + typed IPC** — main owns the trusted workspace root; the renderer sends only
  workspace-relative paths and never the root. `workspace:pickFolder/open/recent/current` and
  `fs:listDir/readFile`, all zod-validated both directions. Restore-last-workspace reopens the most
  recent folder that still exists, like an IDE reopening your project.
- **Virtualised file tree** — a flat list of visible nodes with **lazy** directory loading, so opening
  a 10,000-file repo lists only the root (measured ~70ms). `.gitignore`-aware ignore rules plus an
  always-ignore set (`node_modules`, `.git`, `dist`, …).
- **Monaco under strict CSP** — the ESM build with `?worker` imports bundled locally (no CDN, no
  `unsafe-eval`); tabs over one editor that swaps models keyed by path (Monaco owns the text and undo
  stack, ADR-015); themes derived from `@fixora/tokens`; a read-only diff editor wired for M6.
- **File watcher** — chokidar bundled into the CJS main, debounced and ignore-aware from the first
  commit, coalescing a burst of saves into one batch of changed directories; the renderer reconciles
  only those, preserving the expansion of directories that still exist.
- **Settings surface** — theme, density, a **telemetry opt-in that is off by default** with plain-English
  copy (FR-5), and the keybinding list read from the command registry. Adds a Radix `Switch` to
  `@fixora/ui`. Test count **77 → 154** on the desktop package (renderer store tests, FS/DB/service
  tests, a 10k-file scale benchmark).

#### Fixed (M2 internal audit + red-team, before requesting approval)

- **`workspace:open` no longer trusts an arbitrary renderer path.** It took the folder path straight
  from the renderer and made it the trusted FS root — so a compromised renderer (treated as hostile, I1)
  could set the root to `C:\` and read non-secret files under it. Impact was already bounded (no network
  egress, secrets denylist, path guard), but the boundary now sits at the IPC handler: main only opens a
  folder the user actually picked this session or one that is already a known recent. `open()` stays the
  trusted primitive for internal callers (restoreLast, indexing, tests).

#### Fixed (launch — reported black screen on startup)

- **Black screen on launch (GPU compositing).** On some Windows GPU drivers, Chromium paints the DOM but
  never composites the first frame of a frameless, deferred-show window to the screen — so the window
  stays on its background colour until a resize forces a recomposite. Diagnosed with `FIXORA_DEBUG=1`
  instrumentation (DevTools + a post-load DOM probe showed `#root` fully populated, no console errors):
  the renderer was fine; compositing was the fault. Fixed by moving compositing to the CPU
  (`disable-gpu-compositing`) on Windows while keeping GPU rasterisation, so Monaco stays fast. Verified
  the UI paints on a normal show with zero interaction.
- **`ELECTRON_RUN_AS_NODE` no longer breaks `pnpm dev`.** If that variable is exported in the shell
  (some tooling does, to run Node through an Electron binary), the launched Electron booted as plain
  Node — `app` undefined — and main threw before any window painted. `pnpm dev`/`preview` now go through
  a launcher that strips the variable first.

### M1 — Design system & application shell (2026-07-14)

The app looks and feels like the finished product before it does anything (roadmap M1). No
product functionality yet — the surfaces inside the shell fill in from M2 — but the frame, the
primitives, the theming and the command system are real and tested.

#### Added

- **`@fixora/ui`** — presentational primitives on Radix + CVA (TDD §8), consuming `@fixora/tokens`:
  Button, Input, Kbd, Badge, Skeleton, Tooltip, Dialog, Tabs, Select, DropdownMenu, Toast, plus
  composites ResizablePanels (react-resizable-panels v4, keyboard-operable) and VirtualList
  (`@tanstack/react-virtual`), and a Command surface (cmdk) the palette renders through. Icons are
  inline SVG, not an icon library (Standards §2). Boundary rules forbid the package importing
  `core-*` or `electron`.
- **Density** (Design Review §6.6) — a `data-density` token layer in `@fixora/tokens`. Comfortable
  default + compact override flip every control metric at once via one root attribute: instant, no
  React re-render, no layout shift by construction. Theme switches the same way.
- **Custom title bar** — the window is frameless; the renderer draws the wordmark, drag region and
  Windows-style minimise/maximise/close controls, wired to main over new `window:*` IPC channels.
  Main is the source of truth for the maximised state and pushes it, so the button reflects
  OS-driven changes (Win+Up, double-click) rather than guessing.
- **App shell** (Design Review §5) — activity rail (four views, tooltip-labelled, `aria-current`),
  three-pane resizable workbench with layout persisted through the store, status bar with
  density/theme toggles. A Zustand store owns "what the user clicked" (ADR-015); theme and density
  reflect to root data attributes.
- **Command system** (TDD §8.4) — **one registry drives the ⌘K palette, the global keybindings, and
  the shortcut hints**, verified end-to-end in the real app. `mod` resolves per-platform (⌘/Ctrl).
  The palette is a view over the registry (cmdk for filter + listbox a11y).
- **IPC events layer** — a typed main→renderer event registry (mirroring the request registry), the
  emitter validating every payload before it leaves the privileged process; the preload gains
  `subscribe()` alongside `invoke()`, still zod-free, still never exposing `ipcRenderer`. Foundational
  for M4 deep-links and M5 streaming.
- **Ladle** component workbench (ADR-032) — Vite-native, sharing the app's exact toolchain; stories
  for the primitives with light/dark and compact/comfortable toggles.
- **Accessibility as a gate** — axe-core (called directly) asserts zero critical/serious violations
  across the primitives including open Dialog, Select and DropdownMenu; keyboard operability
  (Enter/Space/arrow/Escape) is tested on the interactive ones. Test count 27 → 77 across packages.

#### Fixed (M1 internal audit + red-team, before requesting approval)

- **The keybinding listener now reads the command registry**, not a parallel props ref — so the
  palette and the shortcuts genuinely share one source, which is the whole point of the registry.
- **Persisted store state is validated on rehydration.** localStorage is untrusted input on every
  launch (it survives upgrades and a compromised renderer can write it); a stale or tampered value
  now degrades to a default instead of crashing a downstream lookup (DB §1: "degrade, never crash").
- Removed an unused `@radix-ui/react-popover` dependency (Standards §2).

### M0 red-team review — adversarial pass before M1 (2026-07-14)

Reviewed as a hostile engineer looking for a way in. One **critical foundational** hole and three
smaller hardenings, each fixed with a fail-first test.

#### Security

- **The renderer's navigation guard trusted _any_ `file:` URL.** `isAppUrl` returned `true` for
  `file:///C:/Users/victim/.ssh/id_rsa`, arbitrary system files, and — worst — UNC paths like
  `file://attacker-host/x`, which initiate an **outbound SMB/NTLM connection to a host the attacker
  chooses**. Not reachable in M0 (nothing untrusted is rendered yet), but it is the exact containment
  boundary M2 leans on the moment Monaco renders a hostile repo. Replaced with a **path-boundary check**
  confining production navigation to the renderer directory — resolving `..`, rejecting UNC — the same
  discipline Security §3 mandates for the filesystem. Development now permits no `file:` navigation at all.
- **`shell.openExternal` was gated on scheme only; Security §2 requires a host allowlist too.** A
  compromised renderer could launch an arbitrary `https://` page (phishing) in the user's real browser.
  Now limited to `fixora.dev` (+ subdomains) and `github.com`, with suffix-trick bypasses
  (`fixora.dev.attacker.com`) explicitly tested and blocked.
- **The IPC router now rejects any call from a non-top frame** (defense-in-depth). The CSP already forbids
  frames and webviews, so this is insurance against a future CSP regression — and the router is the
  foundation every channel inherits, so it is proven here rather than assumed.

#### Assessed clean (stated, because "we looked" is part of the review)

- **Supply chain:** only **four runtime dependencies ship** in the app (`react`, `react-dom`, `zod`, plus
  our own packages); the ~800 lockfile entries are dev tooling that never reaches the binary. This is the
  local-first architecture's dividend — the attack surface of what we distribute is tiny.
- **CSP:** `default-src 'none'`, no `unsafe-eval`, no inline script, frames/objects/base-uri denied.
- **Preload:** 0.5 kB, zod-free, `ipcRenderer` never exposed, the bridge frozen.
- **Fixed:** a preload comment naming the depcruise rule deleted in the audit — corrected to the ESLint
  rule + bundle test that actually enforce it.

Desktop test count 23 → 40.

### M0 audit — self-review before M1 (2026-07-13)

A Staff-Engineer pass over the M0 tree. Twelve issues found by re-reading and *measuring* rather than
trusting the first pass; every fix verified by making its gate fail first, and each recurring class now has
a regression gate so it cannot come back.

#### Security

- **The preload bridge shipped the entire zod library — 120 kB of a 121 kB bundle.** The most privileged
  script in the app, which runs before first paint on every window, was importing the schema-bearing
  barrel to get a list of channel *names*. Split out a zod-free `@fixora/shared-types/channels` entry
  point; the preload is now **0.5 kB**. Validation stays on the router (the privileged side, the only side
  whose validation an attacker cannot route around). Guarded by an ESLint rule (barrel value-imports
  refused, type-imports allowed) **and** a bundle-content test that greps the shipped artifact for zod —
  because dependency-cruiser cannot resolve the workspace subpath and a blind gate is worse than none.
- **A declared-but-unhandled IPC channel now fails fast at startup** (`assertEveryChannelIsHandled`) instead
  of reaching a user's machine and returning a polite "try again". A channel with no handler is a
  placeholder, and Standards §2 says placeholders do not ship.

#### Fixed

- **Two token bugs that silently broke colour.** `theme.css` referenced `--fx-color-text-on-solid`, which no
  longer existed (dangling → invalid CSS), and the status `onSolid` variables were emitted camelCase and so
  were unreachable. The badge-label colour the contrast gate *proves* passes 4.5:1 was rendering colourless.
  A new `css-consistency` test asserts every variable the theme references is defined and kebab-cased.
- **Invalid Tailwind transition.** `duration-[--var]` (v3 syntax) emitted `transition-duration: --fx-…`,
  ignored by every browser, so the button had no transition. Corrected to v4 `duration-(--var)`.
- **A comment that lied about accessibility.** `border.default` was documented as "contrast-checked at 3:1"
  but was never gated — and would have failed (1.6:1). Resolved correctly per WCAG 1.4.11: the *identifying*
  control boundary is `border.strong` (gated, 3.29:1); `border.default` is a resting border legitimately
  below 3:1, as in every mature design system. Comments now match the gate.

#### Changed

- **`App.tsx` no longer fetches in a `useEffect`.** Extracted to `useAppInfo`, per Standards §3 verbatim
  ("a component with a useEffect doing data fetching is a hook that hasn't been extracted yet"). The M1 swap
  to TanStack Query now touches one hook, not the component.
- **Error "next steps" made honest.** A contract violation is deterministic, so it no longer says "try
  again" (Standards §5: a wrong next step is worse than none) — it points at the bug tracker. "Try again"
  remains only where a retry can actually succeed.
- **The window background is the token, not a copied hex** (`dark.bg.canvas`), closing a brand-drift path.

#### Removed

- Dead code and footguns: `ResultSchema` (unused), the `IPC_UNKNOWN_CHANNEL` error code (unreachable after
  fail-fast), the `focus.offset` colour token (never read — the offset shows the surface through), and the
  **public re-export of the raw colour ramps** from `@fixora/tokens` (a component reaching past the semantic
  layer into a raw ramp bypasses the contrast gate; that is now a resolution error, not a review catch).
- Unused dependencies: `zod` from `apps/desktop`, `vitest` from the workspace root.

#### Added

- **Changesets is now configured** (`.changeset/`), not merely installed — Repo §3 mandates it for
  versioning the published packages; `@fixora/desktop` is ignored (its version is the release tag).
- Regression gates for every recurring class above: `css-consistency.test.ts`, `preload-bundle.test.ts`,
  `router.test.ts`, and the preload ESLint rule. Test count 27 → 38.

### M0 — Foundations (2026-07-13)

The repo, the gates, and the security posture — in place **before** there is code to protect. No product
functionality by design: the Electron shell opens a window and proves one IPC channel, and that is all it
is supposed to do.

#### Added

- **Monorepo** — pnpm 11 + Turborepo 2. Strict TypeScript (`strict`, `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`), ESLint 10 + typescript-eslint strict/type-checked at `--max-warnings 0`,
  Prettier, Vitest 4. (ADR-020)
- **`@fixora/tokens`** — the design token layer. One violet accent scale (ADR-026), a 12-step
  violet-tinted neutral ramp, semantic aliases, and four status hues, in **light and dark**. Builds to
  CSS custom properties plus a Tailwind v4 `@theme` layer, consumable by the desktop app and (later) the
  website. Includes a **WCAG 2.2 AA contrast gate over 104 required colour pairs that fails the build**.
- **`@fixora/shared-types`** — the contract layer. The zod IPC registry (the entire renderer→main attack
  surface, enumerable in one file), the typed `FixoraError` union, and `Result`. Depends on nothing but
  zod, enforced. (ADR-018)
- **Hardened Electron shell** — `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`,
  `webviewTag: false`, `disableBlinkFeatures: 'Auxclick'`, permission requests denied by default,
  `setWindowOpenHandler` → deny, `will-navigate`/`will-redirect`/`will-attach-webview` blocked,
  `shell.openExternal` behind an https-only allowlist, single-instance lock. **Strict CSP with no
  `unsafe-eval` and no inline script**, delivered as a response header *and* a meta tag, asserted equal by
  test. (Security §2, ADR-006)
- **Typed IPC router + preload bridge** — zod-validated in **both** directions, built from the contract
  registry rather than hand-written per channel; `ipcRenderer` never reaches the renderer. One demo
  channel (`system:getAppInfo`) proves the path end to end. (ADR-018)
- **`docs/adr/`** — all 28 accepted decisions as individual numbered records, **generated** from
  `docs/03-DECISION-REGISTER.md`, with a CI gate that fails on drift. The register remains the single
  source of truth.
- **CI** — every gate blocking, no override: format, typecheck, lint, unit tests, contrast,
  architectural boundaries, ADR drift, Electronegativity (SARIF → code scanning), gitleaks (full
  history), dependency audit.
- **Architectural boundary enforcement** — invariant I1 (`core-*` never imports `electron` or `react`)
  via dependency-cruiser *and* ESLint `no-restricted-imports`. Verified by planting a violation and
  watching the build fail.

#### Security

- Pinned `tar` to `>=7.5.11` via `overrides`, closing 6 high-severity path-traversal and arbitrary-write
  advisories reached transitively through the Electron security scanner itself. devDependencies are
  **not** excluded from the audit: the release pipeline is production (Security §7).
- Declared `commander` on behalf of `@doyensec/electronegativity`, which imports it without declaring it.
  Fixed with `packageExtensions` rather than by disabling pnpm's strict linking — the strictness is what
  found it, and it is the same strictness that stops `core-*` resolving `electron` by accident (ADR-020).
- Added `disableBlinkFeatures: 'Auxclick'` after Electronegativity found that middle-click can open a
  window along a path that bypasses `setWindowOpenHandler`.

#### Notes

- The gate suite is **`pnpm run ci`** — `pnpm ci` is now a built-in pnpm command that reinstalls
  `node_modules` instead of running the script.
- `apps/desktop` deliberately has no `"type": "module"`: Electron does not support an ESM preload under
  `sandbox: true`, and the sandbox is not negotiable.
- TypeScript is pinned to 6.0.3 — `typescript-eslint@8` does not yet support TS 7, and taking TS 7 would
  silently disable the type-aware lint rules.
