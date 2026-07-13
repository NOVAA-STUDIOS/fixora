# Changelog

All notable changes to Fixora. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Commits are [Conventional Commits](https://www.conventionalcommits.org/) — they generate this file, and
this file is a **product surface on the website** (Repo §3), not an afterthought.

## [Unreleased]

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
