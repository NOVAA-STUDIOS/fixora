# Fixora — Project Status

**Updated:** 2026-07-14 · **Current milestone:** M1 Design system & app shell — **complete, audited + red-teamed, awaiting approval**
**Next milestone:** M2 Workspace, editor, local persistence — **blocked on explicit approval of M1**

---

## Milestones

| #      | Milestone                            | Status                                 | Notes                                  |
| ------ | ------------------------------------ | -------------------------------------- | -------------------------------------- |
| —      | Blueprint                            | ✅ Signed off 2026-07-13               | 28 ADRs accepted                       |
| **M0** | **Foundations**                      | ✅ **Approved — audited + red-teamed** | Signed off 2026-07-14                  |
| **M1** | **Design system & app shell**        | ✅ **Complete — awaiting approval**    | Audited + red-teamed; acceptance below |
| M2     | Workspace, editor, local persistence | ▶ Ready on M1 approval                 | The moat begins to matter here         |
| M3     | Deterministic analysis engine        | ⏸ Not started                          | The moat. Zero AI.                     |
| M4     | Backend, auth, entitlements          | ⏸ Not started                          | Parallelisable with M1–M3              |
| M5     | AI layer + provider abstraction      | ⏸ Not started                          |                                        |
| M6     | The repair loop                      | ⏸ Not started                          | Hardest milestone                      |
| M7     | Launch capability suite (4 profiles) | ⏸ Not started                          |                                        |
| M8     | Packaging, signing, updates          | ⏸ Not started                          |                                        |
| M9     | Commercial layer                     | ⏸ Not started                          |                                        |
| M10    | Website & launch                     | ⏸ Not started                          | Separate repo                          |

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
├─ apps/desktop/          Electron shell — hardened, typed IPC, demo channel, minimal renderer
├─ packages/tokens/       @fixora/tokens — violet + neutral scales, light+dark, contrast gate
├─ packages/shared-types/ zod IPC contract registry, typed error union, Result
├─ tooling/               tsconfig · eslint-config · scripts (ADR sync, gate runners)
├─ docs/                  the blueprint (source of truth) + docs/adr/ (28 generated records)
└─ .github/workflows/     CI — every gate blocking
```

### Gates now blocking on every PR

| Gate                  | What it protects                                      | Enforced by                          |
| --------------------- | ----------------------------------------------------- | ------------------------------------ |
| typecheck             | `strict` + `noUncheckedIndexedAccess`, no `any`       | tsc 6.0.3                            |
| lint                  | Standards §1–§3, `--max-warnings 0`                   | ESLint 10 + typescript-eslint strict |
| unit tests            | 27 tests                                              | Vitest 4                             |
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

## Open items — decided 2026-07-13, in progress

**These are ordered. Item 1 must complete before item 2**, or the restored register would overwrite the
appended ADRs.

### 1. ⏳ Restore `docs/` from your original copy — **action on you**

A `prettier --write .` ran during M0 before `docs/` was in `.prettierignore`. It reformatted all 19
blueprint documents. Table padding and emphasis markers have been restored and verified byte-exact; the
residual delta is **blank lines Prettier inserted around code fences and lists**. No content was changed,
added or lost. **Decision: restore from your own copy.**

```bash
# 1. Overwrite docs/*.md with your originals (leave docs/adr/ alone — it is generated).
# 2. Confirm the only changes are the ones you expect:
git diff --stat -- docs
# 3. Regenerate the ADR records from the restored register and re-check the gate:
pnpm adr:sync && pnpm gate:adr
```

`docs/` is now permanently in `.prettierignore`, and `pnpm format:check` no longer touches it, so this
cannot recur. `docs/adr/` is generated — do not restore it by hand.

### 2. ⏳ Append ADR-029 / 030 / 031 to the register — **queued, blocked on item 1**

**Decision: append.** The three decisions are drafted in full in
[PROJECT_MEMORY.md](./PROJECT_MEMORY.md#m0--foundations-2026-07-13):

- **ADR-029** — electron-vite as the desktop build tool
- **ADR-030** — tokens authored in TypeScript; the "Tailwind preset" is a Tailwind v4 `@theme` layer
- **ADR-031** — `docs/adr/` is generated from the register, and CI fails on drift

I will append them to `docs/03-DECISION-REGISTER.md` and run `pnpm adr:sync` **once you have restored
`docs/`** — doing it before would just be undone.

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
