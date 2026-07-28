# Changelog

All notable changes to Fixora. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Commits are [Conventional Commits](https://www.conventionalcommits.org/) — they generate this file, and
this file is a **product surface on the website** (Repo §3), not an afterthought.

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
