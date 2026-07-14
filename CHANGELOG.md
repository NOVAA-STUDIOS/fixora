# Changelog

All notable changes to Fixora. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Commits are [Conventional Commits](https://www.conventionalcommits.org/) — they generate this file, and
this file is a **product surface on the website** (Repo §3), not an afterthought.

## [Unreleased]

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
