# Fixora — Project Status

**Updated:** 2026-07-13 · **Current milestone:** M0 Foundations — **complete, awaiting sign-off**
**Next milestone:** M1 Design system & application shell — **blocked on explicit approval of M0**

---

## Milestones

| #      | Milestone                            | Status                              | Notes                                     |
| ------ | ------------------------------------ | ----------------------------------- | ----------------------------------------- |
| —      | Blueprint                            | ✅ Signed off 2026-07-13            | 28 ADRs accepted                          |
| **M0** | **Foundations**                      | ✅ **Complete — awaiting approval** | Every acceptance criterion verified below |
| M1     | Design system & app shell            | ⏸ Not started                       | Gated on M0 approval                      |
| M2     | Workspace, editor, local persistence | ⏸ Not started                       |                                           |
| M3     | Deterministic analysis engine        | ⏸ Not started                       | The moat. Zero AI.                        |
| M4     | Backend, auth, entitlements          | ⏸ Not started                       | Parallelisable with M1–M3                 |
| M5     | AI layer + provider abstraction      | ⏸ Not started                       |                                           |
| M6     | The repair loop                      | ⏸ Not started                       | Hardest milestone                         |
| M7     | Launch capability suite (4 profiles) | ⏸ Not started                       |                                           |
| M8     | Packaging, signing, updates          | ⏸ Not started                       |                                           |
| M9     | Commercial layer                     | ⏸ Not started                       |                                           |
| M10    | Website & launch                     | ⏸ Not started                       | Separate repo                             |

---

## M0 acceptance criteria — verified, not asserted

The roadmap defines three. Each was tested by making it fail first.

| Criterion (Roadmap M0)                               | Status | How it was verified                                                                                                                                                                                                                                                                  |
| ---------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm dev` opens a hardened window                   | ✅     | Built app launched; window titled "Fixora"; 4 Electron processes; the IPC round-trip returned real data (`version 0.1.0`, `electron 43.1.0`, `win32/x64`) rendered through the token layer. All 12 hardening flags confirmed present in the **shipped** bundle, not just the source. |
| `pnpm run ci` runs every gate green                  | ✅     | Full suite green: format · typecheck · lint (`--max-warnings 0`) · 27 unit tests · contrast · boundaries · ADR drift · Electronegativity · gitleaks · dependency audit (0 vulnerabilities).                                                                                          |
| A contrast violation in a token file fails the build | ✅     | Planted `#8b5cf6` (violet-500 — the shade a designer would reach for). Gate failed with `4.23:1, needs 4.5:1`; the unit test failed too. Reverted; green.                                                                                                                            |

**Also proven by planted failure:** the boundary gate. An `electron` import added to `packages/shared-types`
produced `error core-no-electron` and failed the build. Invariant I1 is enforced, not merely documented.

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

| Deferred                         | Arrives in      | Why not now                                                                                                                                |
| -------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| E2E (Playwright) + axe-core      | **M1**          | There is no shell to traverse and no component to audit.                                                                                   |
| Secret-gate integration test     | **M5**          | The secret gate is part of `core-ai`. The _test_ is mandatory the day the gate exists.                                                     |
| Golden corpus score              | **M5**          | Requires the AI layer and the verification engine.                                                                                         |
| OpenAPI → TS client codegen diff | **M4**          | Requires the FastAPI service.                                                                                                              |
| `pip-audit`                      | **M4**          | No Python in this repo yet.                                                                                                                |
| Azure Trusted Signing            | **procure now** | ⚠️ Identity validation takes days-to-weeks. Packaging §2 says start in M0. **This is a business action, not a code one — see Open Items.** |

---

## Open items requiring your decision

1. **⚠️ `docs/` were reformatted by Prettier during M0, and partially restored.**
   A `prettier --write .` ran before `docs/` was added to `.prettierignore`. It normalised markdown
   **table padding** and **emphasis markers** (`*x*` → `_x_`) across all 19 documents. Both have been
   restored to the original style and verified byte-exact against the originals. The residual difference
   is **blank lines Prettier inserted around code fences and lists** (~250 lines total). No content was
   changed, added or lost, and the documents render identically.
   **Your call:** accept as-is, restore `docs/` from your own copy, or have me reconstruct them verbatim.
   `docs/` is now permanently in `.prettierignore`; this cannot recur.

2. **Three decisions were made during M0 that are not in the register.** Per Standards §5 ("an ADR written
   if a decision was made") they need ADR-029/030/031. I have **not** appended them to
   `03-DECISION-REGISTER.md`, because that is your source of truth and item 1 above makes me unwilling to
   touch it without asking. They are written up in [PROJECT_MEMORY.md](./PROJECT_MEMORY.md) and are ready
   to append on your word.

3. **Azure Trusted Signing** — Packaging §2 is explicit that the identity-validation process should start
   in M0, not M8, because it takes weeks and it is the difference between a SmartScreen warning and a
   clean first install. This is a procurement action only you can take.

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
