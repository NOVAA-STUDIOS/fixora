# Fixora — Repository Structure & Strategy

## 1. Three repositories + one shared package

| Repo             | Contains                                         | Cadence             | Why separate                                          |
| ---------------- | ------------------------------------------------ | ------------------- | ----------------------------------------------------- |
| `fixora-desktop` | Electron app + `core-*` packages (pnpm monorepo) | Fortnightly, signed | Signed releases, staged rollout, heavy CI             |
| `fixora-api`     | FastAPI gateway                                  | Continuous          | Independent deploys; different language and toolchain |
| `fixora-web`     | Next.js site + docs                              | Hourly              | Marketing must ship without an app release            |
| `@fixora/tokens` | Design tokens (published npm package)            | On design change    | **The single shared surface. Two repos, one brand.**  |

**Why not one monorepo for everything?** Coupled release cadences, a slow CI graph, coarse permissions, and
a marketing typo fix that has to wait behind a signed desktop build. **Why not full separation?** Because
two repos hand-copying hex codes produces brand drift within a month, guaranteed. `@fixora/tokens` is the
minimum shared surface that prevents it — and its cost is one publish step.

---

## 2. `fixora-desktop` layout

```
fixora-desktop/
├─ apps/desktop/
│  ├─ electron/
│  │  ├─ main/          index.ts · windows/ · ipc/ (router, contracts, handlers)
│  │  │                 services/ (workspace, fs, patch, ai, auth, secrets, telemetry, updater)
│  │  │                 db/ (client, migrations/, repositories/) · security/ (csp, navigation-guard)
│  │  ├─ preload/       index.ts   ← the ONLY renderer surface
│  │  └─ workers/       analysis/ · verify/          ← utilityProcess
│  ├─ src/              ← RENDERER
│  │  ├─ app/           App.tsx · router · providers/
│  │  ├─ features/      workspace · editor · diff · findings · repair · explain
│  │  │                 security · tests · assistant · history · settings · auth
│  │  ├─ components/    design-system primitives (no feature logic)
│  │  ├─ hooks/ stores/ lib/ styles/
│  └─ resources/        icons, installer assets
├─ packages/
│  ├─ core-analysis/    PURE TS — tree-sitter, adapters, Finding model
│  ├─ core-ai/          PURE TS — providers, context builder, budgeter, secret gate, profiles
│  ├─ core-patch/       PURE TS — diff generation/parse/apply, checkpoints
│  ├─ shared-types/     zod contracts (IPC + API)
│  └─ ui/               design-system components
├─ tooling/             eslint · tsconfig · tailwind preset · vitest
├─ e2e/                 Playwright (Electron driver)
└─ fixtures/            golden corpus + test repos
```

### The rule that makes this structure worth having

```
packages/core-*  MUST NOT import  electron | react | any app code
```

Enforced by `eslint no-restricted-imports` **and** `dependency-cruiser`, blocking in CI.

This one rule is what makes `fixora-cli`, a GitHub Action, and a VS Code extension cost _weeks_ instead of
_quarters_ — and it is what would make a future Tauri migration (ADR-005) a shell rewrite rather than a
product rewrite. It looks like fussiness in month one and pays for the whole project in year two. **It is
also the rule that will be quietly broken first**, by someone who just needs `app.getPath()` in an analyzer,
which is precisely why it is machine-enforced rather than written on a wiki.

---

## 3. Branching, commits, versioning

- **Trunk-based.** Short-lived branches, squash-merge to `main`. No long-running `develop`. `main` is always
  releasable.
- **Conventional Commits** — they generate the changelog, and the changelog is a _product surface_ on the
  website, not an afterthought.
- **Changesets** for versioning the packages; the app version is the release tag.
- **Release branches** (`release/1.2.x`) only when a hotfix must ship without whatever is currently on
  `main`. Desktop clients can't be hot-fixed (ADR-022), so this path must exist and must be rehearsed
  _before_ the night we need it.

## 4. Required CI gates (all blocking, on every PR)

| Gate                                                                | Repo          |
| ------------------------------------------------------------------- | ------------- |
| typecheck · lint · dependency-cruiser boundaries                    | all           |
| unit tests (Vitest / pytest)                                        | all           |
| **contrast gate** — fails on any WCAG-violating token pair          | desktop, web  |
| **Electronegativity** — Electron misconfiguration scan              | desktop       |
| **secret-gate integration test** — smuggle a live-looking key at it | desktop       |
| **golden corpus score** (from M5) — fails on regression             | desktop       |
| axe-core accessibility (zero critical)                              | desktop, web  |
| gitleaks · `npm audit` · `pip-audit`                                | all           |
| OpenAPI → TS client codegen diff check                              | api + desktop |
| E2E (Playwright)                                                    | desktop       |

A gate that can be skipped is not a gate. None of these have an override.
</content>
</invoke>
