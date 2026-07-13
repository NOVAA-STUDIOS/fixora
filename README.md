# Fixora

> **Fix smarter. Ship faster.**
> Fixora is the workspace you open when the code is already broken.

This is `fixora-desktop` — the Electron app and the framework-free `core-*` packages it is built from.

**The blueprint is in [docs/](./docs/) and it is the source of truth.** If the code and the blueprint
disagree, one of them is a bug. Start with [docs/README.md](./docs/README.md); if you disagree with
something, start with the [Decision Register](./docs/03-DECISION-REGISTER.md).

Current state: **[PROJECT_STATUS.md](./PROJECT_STATUS.md)** · Hard-won context:
**[PROJECT_MEMORY.md](./PROJECT_MEMORY.md)** · What shipped: **[CHANGELOG.md](./CHANGELOG.md)**

---

## Prerequisites

| Tool     | Version | Why                                                        |
| -------- | ------- | ---------------------------------------------------------- |
| Node     | ≥ 22.12 |                                                            |
| pnpm     | 11.12.0 | `npm install -g pnpm@11.12.0`                              |
| gitleaks | any     | The secret gate is not optional. `winget install gitleaks` |

## Commands

```bash
pnpm install
pnpm dev            # opens the hardened Electron window
pnpm run ci         # every gate, exactly as CI runs them  ← note: `run`, see below
```

> **`pnpm run ci`, not `pnpm ci`.** `ci` is a built-in pnpm command that wipes `node_modules` and
> reinstalls. Ours is a script, so it needs `run`.

| Command                | Gate                                                        |
| ---------------------- | ----------------------------------------------------------- |
| `pnpm typecheck`       | strict TS, no `any`, `noUncheckedIndexedAccess`             |
| `pnpm lint`            | typescript-eslint strict, `--max-warnings 0`                |
| `pnpm test`            | Vitest                                                      |
| `pnpm gate:contrast`   | WCAG 2.2 AA over every semantic colour pair, both themes    |
| `pnpm gate:boundaries` | **Invariant I1** — `core-*` never imports electron or react |
| `pnpm gate:adr`        | `docs/adr/` has not drifted from the decision register      |
| `pnpm gate:electron`   | Electronegativity — Electron misconfiguration               |
| `pnpm gate:secrets`    | gitleaks                                                    |
| `pnpm gate:audit`      | dependency vulnerabilities                                  |
| `pnpm adr:sync`        | regenerate `docs/adr/` after changing the register          |

**A gate that can be skipped is not a gate.** None of these have an override (Repo §4).

---

## The four sentences that explain the whole product

1. **The capabilities are one pipeline.** `Ground → Reason → Propose → Verify → Present`, invoked with
   different task profiles. Adding a capability must never require touching the engine. _(ADR-001)_
2. **The LLM reasons over evidence, never over vibes.** Deterministic analysis produces the findings; the
   model explains and repairs them. _(ADR-002)_
3. **Every fix ships with its proof.** Patches are applied to an overlay filesystem, re-checked and
   re-tested before the user ever sees them. _(ADR-003)_
4. **Code stays on the user's machine unless they say otherwise.** _(ADR-004)_

If a change violates one of those four, it is wrong, however convenient.

## The rule that makes this repo worth its structure

```
packages/core-*  MUST NOT import  electron | react | any app code
```

Machine-enforced by `dependency-cruiser` and ESLint, blocking in CI. It looks like fussiness in month one
and pays for the whole project in year two — it is what makes a CLI, a GitHub Action and a VS Code
extension cost weeks instead of quarters.
