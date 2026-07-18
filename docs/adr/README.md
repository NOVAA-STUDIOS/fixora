# Architecture Decision Records

Generated from [../03-DECISION-REGISTER.md](../03-DECISION-REGISTER.md) — **that document is the
source of truth.** These files are per-decision records generated from it, so that an ADR can be
linked, cited and diffed on its own. `pnpm gate:adr` fails CI if they drift apart.

To add or change a decision: edit the register, then run `pnpm adr:sync`.

| # | Decision | Status |
|---|---|---|
| [001](./001-one-pipeline-twelve-task-profiles.md) | One pipeline, twelve task profiles | Accepted |
| [002](./002-deterministic-grounding-before-llm-reasoning.md) | Deterministic grounding before LLM reasoning | Accepted |
| [003](./003-verified-repairs-via-an-overlay-filesystem.md) | Verified repairs via an overlay filesystem | Accepted |
| [004](./004-local-first-data-the-cloud-never-stores-code.md) | Local-first data; the cloud never stores code | Accepted |
| [005](./005-electron-over-tauri.md) | Electron over Tauri | Accepted |
| [006](./006-monaco-over-codemirror-6.md) | Monaco over CodeMirror 6 | Accepted |
| [007](./007-no-python-runtime-in-the-desktop-installer.md) | No Python runtime in the desktop installer | Accepted |
| [008](./008-fastapi-for-the-api-and-the-honest-case-against-it.md) | FastAPI for the API — and the honest case against it | Accepted |
| [009](./009-supabase-as-an-identity-provider-only-neon-owns-the-data.md) | Supabase as an identity provider only; Neon owns the data | Accepted |
| [010](./010-no-supabase-storage-in-v1.md) | No Supabase Storage in v1 | Accepted |
| [011](./011-sqlite-via-better-sqlite3-for-local-persistence.md) | SQLite via better-sqlite3 for local persistence | Accepted |
| [012](./012-provider-abstraction-with-two-live-implementations-from-day-.md) | Provider abstraction with two live implementations from day one | Accepted |
| [013](./013-patches-as-unified-diffs-never-full-file-rewrites.md) | Patches as unified diffs; never full-file rewrites | Accepted |
| [014](./014-sse-over-websockets.md) | SSE over WebSockets | Accepted |
| [015](./015-four-state-owners-zero-overlap.md) | Four state owners, zero overlap | Accepted |
| [016](./016-pkce-in-the-system-browser-never-an-embedded-webview.md) | PKCE in the system browser, never an embedded webview | Accepted |
| [017](./017-analysis-and-verification-run-in-isolated-utility-processes.md) | Analysis and verification run in isolated utility processes | Accepted |
| [018](./018-zod-validated-ipc-as-the-single-renderer-main-boundary.md) | zod-validated IPC as the single renderer↔main boundary | Accepted |
| [019](./019-three-repositories-one-shared-token-package.md) | Three repositories + one shared token package | Accepted |
| [020](./020-pnpm-turborepo-for-the-desktop-monorepo.md) | pnpm + Turborepo for the desktop monorepo | Accepted |
| [021](./021-azure-trusted-signing-over-an-ev-certificate.md) | Azure Trusted Signing over an EV certificate | Accepted |
| [022](./022-self-hosted-release-feed-not-github-releases.md) | Self-hosted release feed, not GitHub Releases | Accepted |
| [023](./023-metering-and-entitlements-before-the-first-token-is-spent.md) | Metering and entitlements before the first token is spent | Accepted |
| [024](./024-ship-4-capabilities-at-launch-not-12.md) | Ship 4 capabilities at launch, not 12 | Accepted |
| [025](./025-three-languages-deep-not-ten-shallow.md) | Three languages deep, not ten shallow | Accepted |
| [026](./026-violet-as-the-single-brand-accent.md) | Violet as the single brand accent | Accepted |
| [027](./027-server-side-kill-switches-for-every-ai-task-profile.md) | Server-side kill switches for every AI task profile | Accepted |
| [028](./028-a-scored-golden-corpus-in-ci-from-m5-onward.md) | A scored golden corpus in CI from M5 onward | Accepted |
| [029](./029-electron-vite-as-the-desktop-build-tool.md) | electron-vite as the desktop build tool | Accepted |
| [030](./030-design-tokens-authored-in-typescript-the-tailwind-preset-is-.md) | Design tokens authored in TypeScript; the Tailwind "preset" is a v4 `@theme` layer | Accepted |
| [031](./031-docs-adr-is-generated-from-this-register-and-ci-fails-on-dri.md) | `docs/adr/` is generated from this register, and CI fails on drift | Accepted |
| [032](./032-ladle-over-storybook-for-the-component-workbench.md) | Ladle over Storybook for the component workbench | Accepted |
| [033](./033-node-sqlite-instead-of-better-sqlite3-for-local-persistence-.md) | `node:sqlite` instead of better-sqlite3 for local persistence (amends ADR-011) | Accepted |
| [034](./034-tree-sitter-via-webassembly-web-tree-sitter-with-prebuilt-gr.md) | tree-sitter via WebAssembly (web-tree-sitter) with prebuilt grammars | Accepted |
| [035](./035-analyzers-are-workspace-scoped-each-tool-runs-once-per-analy.md) | Analyzers are workspace-scoped: each tool runs once per analysis, not per file | Accepted |
| [036](./036-ship-a-byok-first-public-beta-defer-the-managed-tier-to-v1-1.md) | Ship a BYOK-first Public Beta; defer the managed tier to v1.1 | Accepted |
| [037](./037-a-repair-emits-a-replacement-symbol-fixora-derives-the-diff-.md) | A repair emits a replacement symbol; Fixora derives the diff and applies by verified range | Accepted |
| [038](./038-a-local-private-repair-history-audit-trail.md) | A local, private repair-history audit trail | Accepted |
