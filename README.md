# Fixora

> **Fix smarter. Ship faster.**
> Fixora is the workspace you open when the code is already broken.

This is `fixora-desktop` — the Electron app and the framework-free `core-*` packages it is built from.

**Implementation is authoritative for current behavior.** The documents under [docs/](./docs/) include
current operational guidance as well as historical proposals; see [docs/README.md](./docs/README.md)
for status and reading guidance. ADRs record decisions and intent, not proof that a planned service was
deployed.

Current state: **[PROJECT_STATUS.md](./PROJECT_STATUS.md)** · Hard-won context:
**[PROJECT_MEMORY.md](./PROJECT_MEMORY.md)** · What shipped: **[CHANGELOG.md](./CHANGELOG.md)**

---

## Using Fixora (Public Beta)

Not building Fixora, just using it? Start with the **[User Guide](./docs/USER-GUIDE.md)** and verify its
version/status note against the current app. Desktop AI is **BYOK**; current licensing behavior is in
[LICENSING.md](./docs/LICENSING.md). Building locally: **[PACKAGING.md](./docs/PACKAGING.md)**. Production
tag releases and signing: **[RELEASING.md](./docs/RELEASING.md)**. Historical beta acceptance:
**[BETA-ACCEPTANCE.md](./docs/BETA-ACCEPTANCE.md)**.

---

## GitHub PR Integration

[![Fixed by Fixora](https://fixora-opal.vercel.app/badge.svg)](https://fixora-opal.vercel.app)

Fixora can comment on every pull request with the lint/type issues in the changed files, and update
that same comment on every push instead of spamming new ones. To add it to any repo, copy
[`.github/workflows/fixora-pr.yml`](.github/workflows/fixora-pr.yml) and
[`scripts/pr-comment.mjs`](scripts/pr-comment.mjs), then adjust the lint/typecheck commands to match
that repo. It needs no secrets beyond the `GITHUB_TOKEN` GitHub Actions already provides.

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

## Current product shape

Fixora is a pnpm/Turborepo monorepo centered on a Windows-first Electron desktop IDE, plus an independent
Next.js web chat and a VS Code extension. The desktop React renderer uses a sandboxed preload and
Zod-validated shared IPC contracts. Electron main owns workspace filesystem and terminal operations,
SQLite (`node:sqlite`) persistence, and desktop AI orchestration through `packages/core-ai`.

The desktop includes both verified repair/proceed workflows and Zappr. Zappr file plans are schema
validated, workspace-bound, explicitly approved, run-ID-scoped, and use guarded atomic writes with
rollback on failed multi-step execution. These guarantees are specific to those flows: do not infer
that every AI response or every feature uses the same verification pipeline. See
[Architecture Overview](./docs/01-ARCHITECTURE.md) for current boundaries and its clearly marked
historical proposal sections.

## The rule that makes this repo worth its structure

```
packages/core-*  MUST NOT import  electron | react | any app code
```

Machine-enforced by `dependency-cruiser` and ESLint, blocking in CI. It looks like fussiness in month one
and pays for the whole project in year two — it is what makes a CLI, a GitHub Action and a VS Code
extension cost weeks instead of quarters.
