# Fixora — Milestone Roadmap

Sequencing rule: **a demonstrable, sellable product must exist by M7.** Everything after that is
monetisation and expansion. One milestone at a time; each requires explicit approval before starting.

Complexity is expressed in ideal engineer-weeks for one senior engineer.

---

## M0 — Foundations

**Objective.** A repo that a professional would recognise as professional, with the security and quality
gates in place _before_ there is code to protect.

**Deliverables**

- `fixora-desktop` monorepo (pnpm + Turborepo), strict TS config, ESLint + Prettier, Vitest.
- Electron shell that opens a window and does nothing else — but does it with `sandbox: true`,
  `contextIsolation: true`, `nodeIntegration: false`, strict CSP, navigation guards.
- Typed IPC router + zod contracts + preload bridge (one demo channel proving the pattern end-to-end).
- `@fixora/tokens`: design tokens (colour, type, space, radius, motion) → Tailwind preset + CSS vars,
  **light and dark**, with a CI script that fails the build on any WCAG contrast violation.
- CI: typecheck, lint, unit, Electronegativity, gitleaks, dependency audit. All blocking.
- ADR directory (`docs/adr/`) — every decision in the architecture doc gets a numbered record.

**Dependencies.** None. **Complexity.** 2 weeks.
**Risks.** Over-engineering the tooling and never shipping. Timebox it.
**Acceptance.** `pnpm dev` opens a hardened window; `pnpm ci` runs every gate green; a contrast
violation in a token file fails the build.

---

## M1 — Design system & application shell

**Objective.** The app _looks and feels_ like the finished product before it does anything.

**Deliverables**

- Primitive components (Button, Input, Select, Dialog, Popover, Menu, Tooltip, Tabs, Toast, Skeleton,
  Badge, Kbd, Resizable panels, Virtualised list) on Radix, with CVA variants. Light + dark. Compact +
  comfortable density.
- App shell: title bar (custom, Windows-native controls), activity rail, resizable panels with persisted
  layout, status bar.
- **Command system**: a command registry that drives the ⌘K palette, the menu bar, and all keybindings
  from one source.
- Full keyboard traversal; visible focus rings; `prefers-reduced-motion` honoured.
- Storybook (or Ladle) for the primitives.

**Dependencies.** M0. **Complexity.** 3 weeks.
**Risks.** Scope creep in the component library. Build only what M2–M4 consume.
**Acceptance.** Every shell surface is operable with the keyboard alone; axe-core reports zero critical
violations; theme + density switch instantly with no layout shift.

---

## M2 — Workspace, editor, local persistence

**Objective.** Fixora can open a real repository and behave like a competent code viewer.

**Deliverables**

- Open folder; recent workspaces; file watcher; `.gitignore`-aware ignore rules.
- Path-guarded FS service (traversal-proof, symlink-resolved, denylist for secrets files).
- Virtualised file tree; Monaco with tabs, models, syntax highlighting for the initial languages.
- **Monaco diff editor**, wired but not yet fed by AI.
- SQLite (better-sqlite3, WAL) + forward-only migrations + repositories for workspaces/sessions/files.
- Settings surface (theme, density, telemetry opt-in, keybindings).

**Dependencies.** M1. **Complexity.** 3 weeks.
**Risks.** Performance on large repos (10k+ files). The tree and the watcher must be virtualised and
debounced from the first commit, not "optimised later".
**Acceptance.** Opens a 10,000-file repository in under 2 seconds with no dropped frames; the app fully
functions offline and signed-out; DB migration from an empty DB and from v1→v2 both succeed.

---

## M3 — Deterministic analysis engine (`core-analysis`)

**Objective.** The evidence layer. **This is the moat and it contains zero AI.**

**Deliverables**

- Pure-TS package, no Electron/React dependency.
- tree-sitter (WASM) grammars for **TypeScript/JavaScript, Python, Go**. Symbol extraction, scope,
  imports, call graph within a file.
- Analyzer adapters producing a unified `Finding` model: ESLint, `tsc`, ruff/mypy, `go vet`, Semgrep
  (security), plus cyclomatic/cognitive complexity.
- Adapters use the _workspace's own_ tooling when present; nothing bundled that must be signed.
- Utility-process host with cancellation, timeouts, and crash isolation.
- Findings panel: virtualised, grouped, filterable by severity/source/file.

**Dependencies.** M2. **Complexity.** 4 weeks.
**Risks.** Every ecosystem has a different invocation contract and a different output shape. Contain it:
one adapter interface, one normalisation layer, per-language conformance tests.
**Acceptance.** Runs against three real open-source repos (one per language) and produces findings
that match what those repos' own CI produces. **Fixora is genuinely useful at this milestone with no
LLM at all** — that is the test that the grounding layer is real.

---

## M4 — Backend, auth, entitlements

**Objective.** Identity, quota and metering exist _before_ the first token is ever spent.

**Deliverables**

- FastAPI service (layered), Neon + SQLAlchemy 2.0 async + Alembic, Docker, staging deploy.
- Supabase Auth as IdP; JWKS verification; JIT user provisioning.
- Desktop auth: PKCE + system browser + `fixora://` deep link (+ loopback fallback); refresh token in
  OS keychain; tokens never touch the renderer.
- Entitlements + quota + usage metering tables and services. Rate limiting.
- Structured logging with an enforced redaction serializer; OpenTelemetry; Sentry (opt-in).
- Contract tests binding the desktop client to the OpenAPI schema.

**Dependencies.** M0 (parallelisable with M1–M3). **Complexity.** 3 weeks.
**Risks.** Deep-link registration failures on locked-down corporate Windows images — hence the loopback
fallback is a deliverable, not a stretch goal.
**Acceptance.** Sign in via Google and email; kill the app mid-flow and it recovers; a tampered client
cannot exceed its quota; a log line containing source code is rejected by an automated test.

---

## M5 — AI layer (`core-ai`) + provider abstraction

**Objective.** Streaming, budgeted, provider-agnostic reasoning over _grounded_ context.

**Deliverables**

- `AIProvider` protocol; **two live implementations** (Anthropic + OpenAI) — an abstraction with one
  implementation is a lie we tell ourselves.
- Context Builder: symbol-aware slicing via tree-sitter, findings as evidence, repo conventions,
  ranked neighbours. **Token budgeter** with hard caps per profile.
- Task profiles (config + prompt + output schema + model tier), starting with `explain`.
- Structured streaming output (schema-enforced), SSE end-to-end, first-class cancellation.
- Model routing (cheap triage / strong repair) + prompt caching.
- **Secret-scan gate**: no payload leaves the machine without passing it.
- **BYOK mode**: key in keychain, direct-to-provider, our servers bypassed entirely.
- Golden corpus + scoring harness, wired into CI.

**Dependencies.** M3, M4. **Complexity.** 4 weeks.
**Risks.** Prompt/context quality is the whole product and it is not unit-testable in the normal sense —
which is exactly why the scoring harness ships _in this milestone_, not later.
**Acceptance.** "Explain this function" streams a correct, grounded explanation in under 1.5s to first
token; killing the provider forces failover to the secondary with no user-visible error; a file
containing an API key is refused before transmission.

---

## M6 — The repair loop (the product)

**Objective.** Propose a fix, **prove it works**, apply it safely, undo it instantly.

**Deliverables**

- `core-patch`: unified-diff generation, parsing, hunk-level staging, conflict detection by content hash.
- **Verification worker**: copy-on-write overlay FS → re-run analyzers → run affected tests (opt-in,
  sandboxed, time-limited, killable) → `VerificationReport`.
- Regression detection: a patch that fixes finding A but introduces finding B is labelled a regression.
- Repair UI: finding → explanation → **diff** → verification trust surface → hunk-level Apply.
- Checkpoints + one-keystroke undo. Nothing touches disk without a checkpoint.

**Dependencies.** M5. **Complexity.** 5 weeks. **This is the hardest milestone. Do not compress it.**
**Risks.** Test-runner integration across ecosystems; large-repo overlay performance; partially applied
patches. Every one of these is a data-loss risk, so patch application is transactional or it does not
ship.
**Acceptance.** On the golden corpus: ≥70% of proposed fixes verify clean; **0%** of applied patches
leave the workspace in a broken or partially-written state; undo restores byte-identical content in
every case.

---

## M7 — The launch capability suite (4 profiles, one pipeline) — see ADR-024

**Objective.** Prove the architecture: each capability is a task profile plus a renderer.

**Deliverables** — task profiles for **`repair`, `explain`, `security`, `test-gen`** (the v1.0 launch set),
plus **history** (searchable local sessions, findings, patches). `test-gen` output must pass in the
verification sandbox before it is shown — a generated test that fails is not a feature, it is a chore.

**Deliberately NOT in v1.0** (ADR-024): `refactor`, `optimize`, `document`, `best-practices`, `assistant`.
The pipeline supports them; they ship post-launch, each gated on its own golden-corpus score. Twelve
mediocre buttons destroy trust in four excellent ones, and trust is per-product, not per-feature.

**Dependencies.** M6. **Complexity.** 4 weeks _for all four together_ — if any single one takes more than
a few days, the pipeline abstraction has failed and we stop and fix it rather than special-casing.
**Risks.** Feature dilution; pressure to ship the other eight "since they're nearly free". They are nearly
free to _build_ and expensive to _ship badly_.
**Acceptance.** Adding a new profile requires no changes to `core-ai`'s engine, the IPC layer, or the
API. **This is the acceptance test for the entire architecture.**

---

## M8 — Ship it: packaging, signing, updates, telemetry

**Objective.** A stranger can install Fixora on a clean Windows machine and trust it.

**Deliverables**

- electron-builder + NSIS per-user installer; **Azure Trusted Signing**; installer size < 120 MB.
- `electron-updater` against our own release feed; staged rollout; stable/beta channels; delta updates;
  rollback path; SQLite migrations backward-tolerant one version.
- Crash reporting + opt-in telemetry with the apply-rate north-star metric.
- Onboarding: first-run, privacy explanation, workspace selection, a guided first repair.
- Release checklist: clean-VM fresh install, upgrade-over-previous, offline, corporate-proxy.

**Dependencies.** M7. **Complexity.** 3 weeks.
**Risks.** SmartScreen and antivirus false positives. Start signing early (M0 is not too early to buy the
certificate) so reputation accrues before launch.
**Acceptance.** Install → sign in → repair a real bug → auto-update to a new version → rollback, all on
a clean Windows 11 VM, without a single scary OS dialog.

---

## M9 — Commercial layer

**Objective.** Get paid.

**Deliverables** — Stripe (checkout, portal, webhooks, idempotency), plan gating driven by the
entitlements table, upgrade prompts at the quota wall, BYOK as a paid feature, invoices/receipts,
dunning, and a legally real Privacy/Security/DPA page.
**Dependencies.** M4, M8. **Complexity.** 2 weeks.
**Risks.** Webhook reliability (a missed webhook = an angry paying customer with no access). Idempotency
keys and a reconciliation job are mandatory.
**Acceptance.** Subscribe, upgrade, downgrade, cancel, fail a payment, and expire — all six paths
produce the correct entitlement state within seconds.

---

## M10 — Website & launch (separate repo)

**Objective.** The site from the design review — rebuilt with the recommended sections.

**Deliverables** — Next.js (App Router), consuming `@fixora/tokens`; hero with a _real_ product loop;
How it works; four feature pillars; **Security & Privacy page**; Pricing; MDX docs; changelog; FAQ;
status page; light + dark; WCAG AA verified; Lighthouse ≥ 95; OG/social cards; download endpoints
proxied from the API with OS auto-detection.
**Dependencies.** M8, M9. **Complexity.** 2 weeks.
**Acceptance.** Every nav link resolves to real content; the security page answers "does my code leave
my machine" in the first paragraph; the page converts on mobile.

---

## M11+ — Expansion

Teams/SSO → `fixora-cli` + GitHub Action → local models (Ollama) → repo-wide symbol index → macOS/Linux
→ VS Code extension → custom team rules → on-prem gateway.

---

## Critical path summary

```
M0 ─► M1 ─► M2 ─► M3 ─┐
 └──────────► M4 ─────┴─► M5 ─► M6 ─► M7 ─► M8 ─► M9 ─► M10
```

M4 (backend/auth) runs in parallel with M1–M3. Total to a sellable product: **~35 engineer-weeks.**

**The two milestones that determine whether Fixora succeeds are M3 (grounding) and M6 (verification).**
Everything else is table stakes that competent engineers can execute. Those two are the product.
</content>
</invoke>
