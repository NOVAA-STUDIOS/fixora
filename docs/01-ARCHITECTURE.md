# Fixora — System Architecture (v1)

Status: **proposed, awaiting approval.** No code is written against this document until it is signed off.

---

## 1. Product analysis

### 1.1 What we are actually building

The brief lists twelve capabilities (detect, repair, explain, refactor, optimise, secure, document,
test, diff, multi-language, history, chat). Read carefully, these are **not twelve features**. They are
**one pipeline invoked with twelve different intents**:

```
Source + context  →  Ground (deterministic analysis)  →  Reason (LLM)  →  Propose (patch)  →  Verify  →  Present
```

Every one of the twelve is that pipeline with a different *task profile* (prompt strategy, tool set,
verification strategy, output renderer). If we build twelve features we ship twelve half-products and a
maintenance disaster. If we build **one pipeline and twelve task profiles**, feature #13 costs a
config file and a renderer.

**This is the single most important architectural decision in the project.**

### 1.2 The competitive reality

Cursor, Copilot, Windsurf, Cody, and Zed AI already do "LLM sees your code, LLM suggests change" — and
they do it inside the editor the developer already lives in. A standalone Electron app that only does
this is strictly worse than a plugin, because it forces a context switch.

**Therefore Fixora cannot be a chat-over-code app.** It has to be worth leaving the editor for. Two
things justify that, and they must be built into the architecture from day one:

1. **Grounded findings, not hallucinated ones.** Real static analysis (tree-sitter, language servers,
   Semgrep, ESLint, ruff, mypy, Bandit) produces the *evidence*; the LLM *reasons over evidence* rather
   than free-associating. An LLM asked "find security vulnerabilities" with no grounding will invent
   them, and a security tool that cries wolf is uninstalled within a week.
2. **Verified repairs.** A proposed fix is applied to a virtual overlay of the workspace, then the
   linter, the type-checker, and the affected tests are re-run. We present the fix **with its proof**.
   *"Fixora is the only tool that proves the fix compiles and the tests pass before you see it"* is a
   defensible product claim, a marketing headline, and a moat all at once.

Everything below serves those two claims.

### 1.3 The hard constraint nobody plans for: nobody will upload their source code

The target user is a professional developer at a company with an IP policy. Our architecture must be
credible to that person on day one, or we are limited to hobbyists.

**Data policy (architectural, not just legal):**

- **Code is never persisted server-side.** The AI gateway is *stateless*: source snippets pass through
  RAM, are forwarded to the model provider under a zero-retention agreement, and are never written to
  disk or DB.
- **History is local-first.** Sessions, findings, patches and diffs live in a local **SQLite** DB on
  the user's machine. The cloud DB holds accounts, entitlements, quotas and *anonymous* usage
  aggregates — never code.
- **BYOK mode (bring your own key).** Paid/enterprise users can supply their own OpenAI/Anthropic key,
  stored in the OS keychain via Electron `safeStorage`. In BYOK mode the desktop app talks directly to
  the provider and **our servers never see the code at all.** This is a killer trust feature and it is
  nearly free to build if the provider abstraction is designed for it from the start.
- **Local-model mode** (Ollama/llama.cpp) is a later milestone, but the provider interface must not
  make it a rewrite.

---

## 2. Product vision

> **Fixora is the workspace you open when the code is already broken.**

Not an autocomplete. Not a chat window. The place a developer goes when there is a bug, a failing test,
a slow endpoint, a security finding, or a file they inherited and do not understand — and Fixora
returns a *verified* answer with its work shown.

Positioning: **Cursor is where you write code. Fixora is where you fix it.**

---

## 3. Recommended architecture (high level)

```
┌──────────────────────────────────────────── Fixora Desktop (Electron) ───────────────────────────────────────┐
│                                                                                                               │
│  RENDERER (sandboxed, no Node)                MAIN (Node, privileged)         UTILITY PROCESSES (isolated)    │
│  ┌────────────────────────────────┐           ┌────────────────────────┐      ┌────────────────────────────┐  │
│  │ React 18 + TS + Tailwind       │           │ Window & lifecycle     │      │ Analysis worker            │  │
│  │ Monaco editor + diff editor    │           │ Typed IPC router (zod) │      │  • tree-sitter (WASM)      │  │
│  │ Zustand (UI) + TanStack Query  │◄─preload─►│ Workspace/File service │◄────►│  • linter adapters         │  │
│  │ Command palette (⌘K)           │  bridge   │ SQLite (better-sqlite3)│      │  • Semgrep rules           │  │
│  │ Design-system components       │           │ Keychain (safeStorage) │      │ Verification worker        │  │
│  │ Streaming AI panel             │           │ Auto-updater           │      │  • overlay FS + re-check   │  │
│  └────────────────────────────────┘           │ Deep-link auth handler │      │  • test runner (sandboxed) │  │
│                                               └───────────┬────────────┘      └────────────────────────────┘  │
└───────────────────────────────────────────────────────────┼───────────────────────────────────────────────────┘
                                                            │  HTTPS + SSE, short-lived JWT
                                        ┌───────────────────▼──────────────────────┐
                                        │  Fixora API (FastAPI, Python 3.12)       │
                                        │  ┌────────────────────────────────────┐  │
                                        │  │ Auth (verify Supabase JWT via JWKS)│  │
                                        │  │ Entitlements / quota / rate limit  │  │
                                        │  │ AI Gateway (stateless, streaming)  │  │
                                        │  │   └ Provider abstraction ──────────┼──┼──► OpenAI / Anthropic / Gemini / local
                                        │  │ Usage metering → Postgres          │  │
                                        │  │ Billing webhooks (Stripe)          │  │
                                        │  │ Release manifest / update feed     │  │
                                        │  └────────────────────────────────────┘  │
                                        └──────┬──────────────────────┬────────────┘
                                               │                      │
                                   ┌───────────▼─────────┐   ┌────────▼──────────┐
                                   │ Neon PostgreSQL     │   │ Supabase Auth     │  (IdP only)
                                   │ accounts, subs,     │   │ email + OAuth,    │
                                   │ quotas, usage,      │   │ issues JWT (JWKS) │
                                   │ telemetry aggregates│   └───────────────────┘
                                   │ NO USER CODE        │
                                   └─────────────────────┘
```

### 3.1 Challenges to the specified stack

**(a) Supabase Auth + Neon Postgres is a split brain — accept it deliberately, or drop one.**
Supabase Auth's core value is co-location with Supabase's own Postgres, where `auth.uid()` powers Row
Level Security. If our data lives in **Neon**, we get none of that; Supabase becomes _just an identity
provider_. That is a legitimate choice, but it must be explicit:

- Supabase = IdP only. It issues JWTs; FastAPI verifies them against Supabase's **JWKS** endpoint.
- Neon owns a `users` table keyed by `supabase_user_id (uuid, unique)`, populated on first authenticated
  request (JIT provisioning) — **not** by a fragile webhook/sync job.
- **All** authorization happens in FastAPI. We never expose PostgREST. RLS is not our security boundary.
- *Alternative considered:* use Supabase's Postgres for everything and drop Neon. **Rejected** — Neon's
  branching gives us per-PR ephemeral databases, which is worth more to us than RLS we would not use.

**(b) Supabase Storage: not in v1.** What would we store? The only candidates are user code (which we
have just committed to never persisting) and exported reports (which belong on the user's disk). Adding
a storage dependency with nothing to store is unnecessary surface area. Defer to the Teams milestone,
where shared reports and org-level artifacts create a real need.

**(c) Do NOT bundle Python into the Electron installer.**
The backend is Python; the *desktop app* must not be. Shipping a CPython runtime inside Electron means a
~150 MB installer, a code-signing nightmare, PATH/DLL hell on Windows, and an antivirus false-positive
magnet. **All local analysis runs in Node/TS inside a utility process, using tree-sitter WASM grammars.**
Language-specific linters that the user already has installed (`eslint`, `ruff`, `tsc`, `pytest`) are
invoked as *optional* subprocesses when detected in the workspace — never bundled.

**(d) SSE, not WebSockets.** Token streaming is unidirectional. SSE over HTTP/2 gives us streaming,
trivial cancellation (abort the request), and no stateful connection layer to scale. WebSockets buy us
nothing here and cost us load-balancer complexity.

---

## 4. Folder structure

Two independent repositories, as specified. A third, tiny, shared package for brand truth.

### 4.1 `fixora-desktop` (monorepo, pnpm + Turborepo)

```
fixora-desktop/
├─ apps/
│  └─ desktop/
│     ├─ electron/
│     │  ├─ main/
│     │  │  ├─ index.ts                    # app lifecycle, single-instance lock
│     │  │  ├─ windows/                    # BrowserWindow factories, state persistence
│     │  │  ├─ ipc/
│     │  │  │  ├─ router.ts                # typed channel registry
│     │  │  │  ├─ contracts.ts             # zod schemas — the ONLY IPC surface
│     │  │  │  └─ handlers/                # one file per domain
│     │  │  ├─ services/
│     │  │  │  ├─ workspace.service.ts     # open folder, watch, ignore rules
│     │  │  │  ├─ fs.service.ts            # path-guarded FS (no traversal outside workspace)
│     │  │  │  ├─ patch.service.ts         # apply/revert unified diffs, checkpoints
│     │  │  │  ├─ analysis.client.ts       # talks to analysis worker
│     │  │  │  ├─ ai.client.ts             # talks to Fixora API or BYOK provider
│     │  │  │  ├─ auth.service.ts          # PKCE + deep link + keychain
│     │  │  │  ├─ secrets.service.ts       # safeStorage wrapper
│     │  │  │  ├─ telemetry.service.ts     # opt-in, no code, no paths
│     │  │  │  └─ updater.service.ts       # electron-updater, channels
│     │  │  ├─ db/
│     │  │  │  ├─ client.ts                # better-sqlite3, WAL
│     │  │  │  ├─ migrations/              # numbered, forward-only
│     │  │  │  └─ repositories/            # sessions, findings, patches, chats
│     │  │  └─ security/
│     │  │     ├─ csp.ts
│     │  │     └─ navigation-guard.ts      # will-navigate, setWindowOpenHandler
│     │  ├─ preload/
│     │  │  └─ index.ts                    # contextBridge — exposes ONLY the typed API
│     │  └─ workers/
│     │     ├─ analysis/                   # utility process: tree-sitter, linters, semgrep
│     │     └─ verify/                     # utility process: overlay FS, re-check, tests
│     ├─ src/                              # RENDERER
│     │  ├─ app/
│     │  │  ├─ App.tsx
│     │  │  ├─ router.tsx
│     │  │  └─ providers/                  # query client, theme, command palette, toasts
│     │  ├─ features/                      # vertical slices — the primary unit of code
│     │  │  ├─ workspace/                  # file tree, tabs, open/close
│     │  │  ├─ editor/                     # Monaco wrapper, models, decorations
│     │  │  ├─ diff/                       # diff editor, hunk staging, apply/undo
│     │  │  ├─ findings/                   # problem list, severity, filters, grouping
│     │  │  ├─ repair/                     # the fix loop UI + verification trust surface
│     │  │  ├─ explain/
│     │  │  ├─ refactor/
│     │  │  ├─ optimize/
│     │  │  ├─ security/
│     │  │  ├─ tests/
│     │  │  ├─ docs/
│     │  │  ├─ assistant/                  # chat, grounded in the open workspace
│     │  │  ├─ history/
│     │  │  ├─ settings/                   # incl. BYOK, privacy, model routing
│     │  │  └─ auth/
│     │  ├─ components/                    # design-system primitives (no feature logic)
│     │  ├─ hooks/
│     │  ├─ stores/                        # zustand slices
│     │  ├─ lib/
│     │  └─ styles/
│     └─ resources/                        # icons, installer assets, entitlements
├─ packages/
│  ├─ core-analysis/                       # PURE TS. tree-sitter, rule engine, finding model.
│  │  │                                    # No Electron, no React → unit-testable, reusable
│  │  │                                    # in a future CLI / CI action / VS Code extension.
│  │  ├─ src/languages/                    # per-language adapters
│  │  ├─ src/analyzers/                    # lint, types, security, complexity, perf
│  │  └─ src/model/                        # Finding, Location, Severity, Evidence
│  ├─ core-ai/                             # provider abstraction, prompt/context builder,
│  │                                       # task profiles, token budgeting, streaming parser
│  ├─ core-patch/                          # unified-diff generation/parse/apply, checkpoints
│  ├─ shared-types/                        # IPC + API contracts (zod → TS types)
│  └─ ui/                                  # design-system components (shared w/ website later)
├─ tooling/                                # eslint, tsconfig, tailwind preset, vitest config
├─ e2e/                                    # Playwright (Electron driver)
└─ turbo.json / pnpm-workspace.yaml
```

**Why `packages/core-*` exist as pure TS:** they are the intellectual property. Keeping them free of
Electron and React means (a) they are unit-testable without a display, (b) a `fixora-cli` and a CI
GitHub Action — the obvious 2027 products — cost weeks, not quarters, and (c) the renderer cannot
accidentally take a dependency on Node.

### 4.2 `fixora-api` (FastAPI)

```
fixora-api/
├─ src/fixora/
│  ├─ main.py
│  ├─ api/v1/                    # routers: auth, ai, usage, billing, releases, health
│  ├─ core/                      # config (pydantic-settings), security, logging, errors
│  ├─ domain/                    # entities + rules — framework-free
│  ├─ services/                  # entitlements, quota, metering, release
│  ├─ ai/
│  │  ├─ base.py                 # AIProvider protocol
│  │  ├─ providers/              # openai.py, anthropic.py, gemini.py, local.py
│  │  ├─ router.py               # model routing: triage(cheap) vs repair(strong)
│  │  ├─ profiles/               # task profiles (repair, explain, secure, test, …)
│  │  └─ streaming.py            # SSE, cancellation, partial-failure handling
│  ├─ db/                        # SQLAlchemy 2.0 async, Alembic migrations
│  └─ observability/             # OpenTelemetry, structured logging
├─ tests/
└─ pyproject.toml (uv)
```

### 4.3 `fixora-web` (Next.js, separate repo — as specified)

App Router, static-first, MDX docs, changelog from a content collection, Stripe checkout entry, and the
release/download endpoints proxied from the API.

### 4.4 `@fixora/tokens` (tiny published package)

The one thing that crosses the repo boundary. Design tokens authored once (JSON), built to a Tailwind
preset + CSS variables. Both repos consume it. **This is how two repos keep one brand.**

---

## 5. Technology justification (and where I disagree)

| Layer | Choice | Justification | My position |
|---|---|---|---|
| Shell | Electron | Monaco needs Chromium. Tauri would halve the installer but forces us to give up Monaco's full feature set and adds a Rust surface we cannot staff. | **Agree** |
| UI | React 18 + TS | Monaco's ecosystem, hiring pool, and our component reuse with Next.js. | **Agree** |
| Styling | Tailwind + CVA | Tokens → utilities → variants. Zero runtime CSS-in-JS cost in an app that must feel native. | **Agree** |
| Editor | Monaco | Same engine as VS Code; the diff editor is free and it is *the* product surface. | **Agree** |
| Renderer state | Zustand + TanStack Query | Server cache ≠ UI state. Redux is ceremony we do not need. | **Agree, with the split enforced** |
| Local DB | **SQLite (better-sqlite3)** | *Not in the brief.* Required by the local-first privacy stance and by offline history. | **Adding — high conviction** |
| API | FastAPI | Async, Pydantic contracts, and Python is where the AI/analysis ecosystem lives. | **Agree** |
| Cloud DB | Neon Postgres | Branching → ephemeral DB per PR. Serverless scale-to-zero fits our early load curve. | **Agree — but no code stored** |
| Auth | Supabase Auth | Good IdP: email, OAuth, MFA, JWKS. We use it *only* as an IdP. | **Agree, with caveats above** |
| Storage | Supabase Storage | Nothing to store in v1. | **Defer** |
| AI | Provider abstraction | Non-negotiable; also enables BYOK and local models. | **Agree, strongly** |
| Packaging | electron-builder + NSIS | Mature, delta updates, `electron-updater` integration. | **Agree** |
| Signing | **Azure Trusted Signing** | ~$10/mo vs $300+/yr for an EV cert, and it grants SmartScreen reputation immediately. | **Adding** |
| Payments | **Stripe** | *Not in the brief but the product is commercial.* Must be designed in now, not bolted on. | **Adding** |

---

## 6. Desktop architecture (Electron)

### 6.1 Process model

- **Main (Node, privileged):** the only process with filesystem, network-to-our-API, keychain, and OS
  access. Owns SQLite. Hosts the IPC router.
- **Renderer (sandboxed):** `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`. It has
  **no** Node APIs. Everything it needs arrives through the preload bridge.
- **Utility processes (`utilityProcess`):** analysis and verification. Isolated so that a runaway
  tree-sitter parse, a hostile regex in a Semgrep rule, or a user's `pytest` cannot freeze the UI or
  take down the app. Crashable and restartable.

### 6.2 IPC — the security boundary

Every channel is declared once in `ipc/contracts.ts` as a zod schema pair (`request`, `response`). The
router validates **both directions** at runtime. The preload exposes a single frozen object; no
`ipcRenderer` reaches the renderer. Channels are namespaced (`workspace:openFolder`,
`analysis:run`, `ai:stream`) and every handler re-checks that the target path is inside the currently
open workspace root — **path traversal is the #1 realistic exploit in a tool that reads local files.**

### 6.3 The verification sandbox (the hardest part of the product)

When a patch is proposed:

1. Materialise an **overlay filesystem**: the workspace as it exists on disk, plus the patch applied
   in a temp directory (copy-on-write via hardlinks for speed on large repos).
2. Re-run the **grounding checks** that produced the finding (linter, type-check, Semgrep).
3. Detect and run **affected tests** only (via the test framework's own filtering).
4. Compare before/after finding sets. **A fix that resolves the target finding but introduces a new one
   is presented as a regression, not a fix.**
5. Emit a `VerificationReport` that the UI renders as the trust surface.

**Risk:** running the user's test suite is arbitrary code execution on their machine. It is *their* code
on *their* machine, so this is not a privilege escalation — but it must be **explicitly opt-in per
workspace**, sandboxed to the workspace directory, time-limited, and killable. Never on by default.

---

## 7. Frontend architecture

- **Feature-sliced.** Each folder under `features/` owns its components, hooks, store slice and API
  calls. Cross-feature imports go through `components/`, `lib/`, or explicit public `index.ts` exports.
  This is what stops a 200-file app from becoming a hairball.
- **Three kinds of state, three tools, no overlap:**
  1. *Server/async state* → **TanStack Query** (AI results, entitlements, history queries). Retries,
     cancellation, cache invalidation for free.
  2. *Client UI state* → **Zustand** slices (panel sizes, active tab, selection, palette open).
  3. *Editor state* → **Monaco models**, which own their own undo stack. We do not mirror file contents
     into Zustand — that is a classic Monaco integration bug (double source of truth, lost undo).
- **Streaming:** AI responses arrive as SSE and are reduced into a structured object incrementally
  (findings appear as they stream). The UI must render partial results — a spinner for 20 seconds is
  a product failure.
- **Virtualisation** everywhere lists can be long (file tree, findings, history) — `@tanstack/virtual`.
- **Accessibility:** Radix primitives for every overlay (dialog, popover, menu, tooltip) so focus
  management, escape handling and ARIA are correct by construction. Full keyboard operability is a
  release blocker, not a nice-to-have — our users are keyboard users.
- **Command palette (⌘K/Ctrl+K)** is a first-class subsystem, not a component: every action in the app
  registers a command with an id, title, keybinding and predicate. This gives us the palette, the menu
  bar, and the keyboard shortcuts from one registry.

---

## 8. Backend architecture

- **Layered, framework-free core.** `api/` (HTTP) → `services/` (use cases) → `domain/` (rules) → `db/`
  (persistence). Routers contain no business logic; the domain imports nothing from FastAPI. This is
  what makes the AI gateway testable without a network.
- **Stateless.** No sticky sessions, no server-side conversation store. Conversation context is
  reconstructed by the client each turn from local SQLite. Horizontal scaling is then trivial.
- **The AI gateway is a pass-through with a budget:**
  `verify JWT → load entitlement → check quota → build provider request → stream → meter tokens → record usage`.
  Code passes through memory only. Structured logs record token counts, latency, model, task profile —
  **never prompt or completion content.** Add an explicit `# NEVER LOG PROMPT CONTENT` invariant test.
- **Idempotency keys** on any mutating endpoint (billing, usage) so retries from a flaky desktop
  network cannot double-charge.
- **Rate limiting** at two levels: per-IP (edge) and per-user-entitlement (application), because the
  desktop client is untrusted and can be tampered with.

---

## 9. Database schema

### 9.1 Cloud (Neon Postgres) — *contains no source code, ever*

```
users                 id, supabase_user_id (uniq), email, display_name, created_at,
                      deleted_at, telemetry_opt_in, data_region
subscriptions         id, user_id, stripe_customer_id, stripe_subscription_id,
                      plan (free|pro|team), status, current_period_end, seats
entitlements          id, user_id, plan, monthly_token_limit, concurrent_requests,
                      byok_enabled, local_models_enabled, features (jsonb)
usage_events          id, user_id, ts, task_profile, provider, model,
                      input_tokens, output_tokens, cost_micros, latency_ms,
                      status, workspace_hash (salted; NOT a path)
usage_rollups         user_id, period_start, tokens_in, tokens_out, cost_micros, requests
api_keys              id, user_id, name, key_hash, last_used_at, revoked_at   (for CLI/CI later)
byok_credentials      id, user_id, provider, ciphertext (KMS-envelope), created_at
                      -- OPTIONAL cloud sync of BYOK keys; default is keychain-only, never uploaded
devices               id, user_id, platform, app_version, install_id, last_seen_at
releases              id, channel (stable|beta), version, platform, arch, url,
                      sha512, size, notes_md, published_at, rollout_percent
audit_log             id, actor_user_id, action, target, metadata (jsonb), ts
```

Every user-scoped table carries `user_id` and every query filters on the JWT subject in the service
layer. Soft deletes (`deleted_at`) plus a hard-delete job for GDPR erasure requests.

### 9.2 Local (SQLite, on the user's machine) — *where the real work lives*

```
workspaces        id, root_path, name, last_opened_at, settings_json
sessions          id, workspace_id, task_profile, started_at, ended_at, status
files_index       id, workspace_id, rel_path, language, size, mtime, content_hash
findings          id, session_id, file_id, rule_id, source (eslint|semgrep|tsc|ai),
                  severity, line_start, line_end, message, evidence_json, confidence
patches           id, finding_id, session_id, unified_diff, rationale_md,
                  model, tokens_in, tokens_out, created_at
verifications     id, patch_id, status (passed|failed|regressed|skipped),
                  checks_json, tests_run, tests_passed, duration_ms
applications      id, patch_id, applied_at, reverted_at, checkpoint_id
checkpoints       id, workspace_id, created_at, snapshot_ref   -- for one-key undo
chats / messages  session-scoped assistant history
```

**Migrations are forward-only and numbered**, run on app start, inside a transaction, with a backup of
the DB file taken first. A corrupted local DB must degrade to "history unavailable", never to "app will
not launch".

---

## 10. Authentication flow

**Never render a login form inside the Electron window, and never use an embedded webview for OAuth.**
Google blocks embedded webviews outright, and it trains users to type credentials into a window whose
origin they cannot verify.

**Authorization Code + PKCE, via the system browser, returned by deep link:**

```
1. Main generates code_verifier + code_challenge (S256) + state (CSPRNG).
2. shell.openExternal → Supabase authorize URL, redirect_uri = fixora://auth/callback
3. User authenticates in their real browser (password manager, SSO, MFA all work).
4. OS deep-link → app.setAsDefaultProtocolClient('fixora'); single-instance lock forwards
   the URL to the running window.
5. Main validates `state`, exchanges code + verifier for tokens.
6. refresh_token → OS keychain via safeStorage (DPAPI on Windows / Keychain on macOS).
   access_token → memory only. Never in localStorage. Never in the renderer.
7. Renderer receives only { user, plan, entitlements } — never a token.
8. Main attaches the bearer token to API calls and refreshes silently on 401.
```

Fallback for environments where protocol registration fails (some corporate images): a **loopback
listener** on `127.0.0.1:<random>` as the redirect URI. Implement both; try deep link first.

FastAPI verifies the JWT against Supabase's **JWKS** (cached, with rotation), checking `iss`, `aud`,
`exp`. On first valid token for an unknown `sub`, JIT-provision the Neon `users` row.

**The app must remain usable, offline and unauthenticated, for local static analysis.** Only
cloud-AI features require a session. This is both a good UX decision and a good trust signal.

---

## 11. AI request flow

```
User invokes intent ("Repair this")
  └─► Context Builder (local, in core-ai)
        • target file + precise symbol range
        • tree-sitter derived: enclosing function, imports, type defs, call sites
        • grounded findings for this range (eslint/tsc/semgrep output — the EVIDENCE)
        • relevant neighbours via the symbol graph, ranked; embeddings only as a fallback
        • repo conventions (lint config, tsconfig strictness, test framework)
        └─► TOKEN BUDGETER: hard cap per profile; drops lowest-ranked context first,
            never silently truncates mid-symbol
  └─► Task Profile ("repair") selects: system prompt, output schema, model tier, temperature
  └─► Transport
        • Managed mode → Fixora API (SSE). JWT, quota check, metering.
        • BYOK mode    → provider SDK directly from main process. Our servers see nothing.
  └─► Provider abstraction  →  OpenAI | Anthropic | Gemini | Ollama
        • normalised streaming events: token | tool_call | structured_delta | usage | error
        • structured output enforced by schema (no regex-parsing of markdown code fences)
  └─► Response is a PATCH (unified diff) + rationale + confidence — NEVER a full-file rewrite.
        (Full-file rewrites destroy formatting, blow the token budget, and silently drop code.)
  └─► Verification worker: overlay FS → re-run checks → run affected tests
  └─► UI: diff + explanation + verification report → user reviews → Apply → checkpoint written
```

**Model routing (cost control, designed in from day one):**

- *Triage/classification* → small, fast, cheap model.
- *Repair/refactor/security reasoning* → frontier model.
- *Embeddings/indexing* → embedding model, computed locally where possible.
  Prompt caching on the stable prefix (system + repo conventions) cuts cost materially on multi-turn work.

**Failure modes we design for explicitly:** provider 429/5xx (retry with jitter, then failover to the
secondary provider — this is the *real* payoff of the abstraction), context overflow (budgeter must
prevent it, not react to it), malformed structured output (schema-validate and re-ask once, then fail
loudly), stream interruption (resumable or cleanly cancelled — never a half-applied patch).

---

## 12. State management strategy

Covered in §7. The rule: **TanStack Query owns anything that came over a wire. Zustand owns anything
the user clicked. Monaco owns text. SQLite owns anything that must survive a restart.** Four owners,
zero overlap. Any PR that mirrors state across two of them is rejected.

---

## 13. Error handling strategy

- **A typed `Result`-style error union across the IPC and API boundary.** Errors are values with a
  `code` (`WORKSPACE_NOT_FOUND`, `QUOTA_EXCEEDED`, `PROVIDER_UNAVAILABLE`, `PATCH_CONFLICT`,
  `VERIFICATION_TIMEOUT`), a user-facing message, and an optional recovery action. Exceptions are for
  bugs, not for expected conditions.
- **Every error surfaced to the user names the next step.** "Quota exceeded" is a dead end;
  "You have used your 2M monthly tokens. Upgrade, or add your own API key in Settings → AI" is a
  product.
- **React error boundaries per feature slice** — a crash in the findings panel must not white-screen the
  editor with unsaved work in it.
- **The renderer must survive main-process service failure.** If the analysis worker dies, the editor
  keeps working and the findings panel shows a retry.
- **Never lose user work.** Patch application is transactional: checkpoint → apply → verify on disk →
  commit, with automatic rollback on any failure. Conflicts (file changed on disk since the patch was
  generated) are detected by content hash and re-proposed, never force-applied.

---

## 14. Logging strategy

- **Structured JSON logs** (pino in Node, structlog in Python), correlated by a `request_id` generated
  in the renderer and propagated through IPC → main → API → provider.
- **Local:** rotating file logs (`app.log`, 10 MB × 5) in `app.getPath('logs')`, exposed via
  *Help → Open Logs*. A "Copy diagnostics" button that produces a redacted bundle turns unreproducible
  bug reports into fixable ones.
- **Redaction is enforced at the logger, not the call site.** A serializer strips absolute paths (→
  workspace-relative), tokens, keys, and any field named `content`/`code`/`prompt`/`completion`. A unit
  test asserts that a log call containing source code emits nothing.
- **Crash reporting:** Sentry (desktop + API), with `beforeSend` scrubbing paths and source snippets,
  and **opt-in on first run** with a plain-English explanation of what is sent.
- **Telemetry:** opt-in, anonymous, event-level (`repair.proposed`, `repair.applied`,
  `verification.failed`), never containing code, filenames, or repo identifiers. The one metric that
  matters is **apply-rate of proposed fixes** — that is our product-quality north star.

---

## 15. Security strategy

**Desktop hardening (all mandatory, enforced by an automated Electronegativity scan in CI):**
`contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, `webSecurity: true`,
`allowRunningInsecureContent: false`, no `remote` module, strict CSP with no `unsafe-eval`
(Monaco is configured to work without it), `setWindowOpenHandler` → deny all, `will-navigate` → block
any non-app origin, `shell.openExternal` only on an allowlist of schemes/hosts, ASAR + integrity
checking, and no `webview` tags.

**Filesystem:** every path from the renderer is canonicalised and asserted to be inside the open
workspace root before any read/write. Symlinks are resolved before the check. Denylist for
`.env`, `.git/config`, `id_rsa`, `.npmrc`, `.aws/` — **these are never sent to a model**, and a
secret-scanner (gitleaks rules) runs over any content in a prompt payload as a final gate.

**Secrets:** BYOK keys and refresh tokens go to the OS keychain via `safeStorage` — never to
`localStorage`, never to a plaintext config file, never to logs. Our own provider keys exist **only**
on the server. There is no scenario in which a provider key is shipped inside the binary.

**Backend:** JWT verification via JWKS with rotation; per-user rate limits (the client is untrusted);
SQLAlchemy parameterised queries only; strict CORS (the desktop app is not a browser origin — the API
does not need permissive CORS at all); secrets from a secret manager, never env files in the image;
dependency scanning (`pip-audit`, `npm audit`, Dependabot) and SBOM generation in CI.

**Supply chain:** pinned lockfiles, `pnpm` with `--frozen-lockfile`, provenance attestations on
releases, and signed installers. An Electron app is a *code execution vector* — a compromised
dependency in our build ships malware to every customer. Treat the release pipeline as production.

---

## 16. Auto-update strategy

- `electron-updater` against a **release feed served by our own API** (not a raw GitHub release), so we
  control **staged rollout** (`rollout_percent`) and can halt a bad release instantly.
- **Channels:** `stable` and `beta`. Users opt into beta in Settings.
- **Signed + hashed:** every artifact has a SHA-512 in the manifest; `electron-updater` verifies the
  signature *and* the hash. An unsigned or mismatched artifact is refused.
- **Delta updates** via blockmaps so a patch release is a few MB, not 90.
- **Never restart under the user.** Download in the background, then a non-blocking toast:
  "Update ready — restart when you like." Force-restart only for a security release, with a clear reason.
- **Rollback:** keep the previous version's installer cached; a `--rollback` path and a documented
  manual downgrade. Migrations of the local SQLite DB must be **backward-tolerant for one version** so a
  rollback does not brick the user's history.

---

## 17. Packaging strategy

- `electron-builder` → **NSIS** (per-user install by default; no admin prompt → far higher conversion)
  with an optional machine-wide MSI for enterprise.
- **Azure Trusted Signing** for the Windows signature. It is ~$10/month against $300–500/year for a
  traditional EV certificate, and it inherits Microsoft's SmartScreen reputation immediately — which
  means the first user does not see "Windows protected your PC".
- **Build in CI, never on a laptop.** Reproducible, signed, attested, on a clean runner.
- **Size discipline:** target < 120 MB installed. Ship tree-sitter grammars as WASM, lazy-load Monaco
  language workers, and exclude every dev dependency from the ASAR. Audit the bundle each release —
  Electron apps rot into 400 MB by accident.
- **macOS later:** notarization + hardened runtime + universal binary. **Linux later:** AppImage + deb.
  Structure the builder config for three targets *now* so adding them is configuration, not surgery.

---

## 18. Testing strategy

| Layer | Tool | What it must prove |
|---|---|---|
| Unit | Vitest (TS) / pytest (Py) | `core-analysis`, `core-patch`, `core-ai` budgeter/parsers, entitlement rules |
| Contract | zod + schemathesis | The IPC contracts and the OpenAPI schema cannot drift from the client |
| Golden / regression | Vitest snapshots | **A corpus of real broken files with known-correct fixes.** This is our most valuable test asset — it is how we detect a prompt or model change silently making the product worse. |
| Integration | pytest + testcontainers | API ↔ Postgres ↔ mocked providers; quota and metering correctness |
| E2E | Playwright (Electron) | Open workspace → analyse → propose → verify → apply → undo, on a real fixture repo |
| Security | Electronegativity, Semgrep, gitleaks, pip-audit | Runs on every PR; a failed check blocks merge |
| Performance | Custom harness | Cold start < 2s, analysis of a 10k-file repo without UI jank, first AI token < 1.5s |
| Accessibility | axe-core in E2E | Zero critical violations; full keyboard traversal of every screen |
| Manual | Release checklist | Fresh-install, upgrade-over-previous, and offline paths on a clean Windows VM |

**The golden corpus deserves emphasis.** In an AI product, the model, the prompt, and the context
builder are all "code" that can regress with no compile error and no failing unit test. A scored
benchmark (does the fix resolve the finding? does it introduce a new one? do tests still pass?) run in
CI on every prompt change is the difference between a product that improves and one that drifts.

---

## 19. Deployment strategy

- **API:** container → **Fly.io or Railway** to start (fast, cheap, multi-region when we need it);
  the app is stateless so this is a reversible decision. Blue/green with health checks.
- **DB:** Neon. **Branch-per-PR** ephemeral databases; Alembic migrations gated in CI; automated backups
  and a *tested* restore (an untested backup is not a backup).
- **Website:** Vercel, its own repo, its own pipeline.
- **Releases:** tag → CI builds + signs Windows artifacts → uploads → writes a `releases` row at
  `rollout_percent = 0` → we promote 5% → 25% → 100%, watching Sentry crash-free-sessions between steps.
- **Environments:** `local` → `staging` (real Neon branch, test Stripe, beta channel) → `production`.
  No manual production deploys, ever.
- **Kill switches:** server-side feature flags for every AI task profile, so a misbehaving profile can be
  disabled for all users **without shipping a desktop update**. This is essential — desktop clients in
  the wild cannot be hot-fixed.

---

## 20. Future scalability roadmap

1. **Teams** — orgs, seats, shared rules, shared history (opt-in), SSO/SAML. This is where the ARPU is.
2. **`fixora-cli` + GitHub Action** — the same `core-analysis`/`core-ai` packages, run in CI, commenting
   on PRs. Near-zero marginal engineering cost *because* the core is framework-free. This is the fastest
   path from a desktop tool to a team purchase.
3. **Local models** (Ollama) — the enterprise unlock: "your code never leaves the building."
4. **Repo-wide intelligence** — persistent symbol graph + incremental index, enabling cross-file
   refactors and architectural review, not just single-file repair.
5. **VS Code / JetBrains extensions** — meet users where they already are; the desktop app becomes the
   deep-work surface and the extension the daily driver.
6. **Custom rules** — let teams encode their own conventions as rules the LLM must respect. Extremely
   sticky.
7. **On-prem / self-hosted gateway** — the enterprise cheque.
8. **Data region residency** (EU) — a hard requirement the first time a European company evaluates us.

---

## 21. Potential weaknesses (honest list)

1. **We are not the editor.** Every context switch out of VS Code is a tax on our usage. Mitigation:
   be dramatically better at the *fix* loop than an inline plugin can be (verification, whole-repo
   grounding, side-by-side diff), and ship an extension that hands off to the app.
2. **AI cost can invert the business model.** A power user on an unlimited plan can burn more in tokens
   than they pay. Mitigation: metering + entitlements from milestone one, model routing, prompt caching,
   BYOK as the pressure valve. **Never ship "unlimited".**
3. **Trust.** One incident of Fixora sending a `.env` to a model provider is an extinction event.
   Mitigation: secret-scan gate in the prompt path, local-first default, a *real* security page, and an
   independent audit before the paid launch.
4. **Verification is expensive and fragile** across ecosystems. Running a stranger's test suite reliably
   is genuinely hard. Mitigation: tier it — static checks always (cheap, universal), type-check when a
   config is detected, tests only when opted in. Degrade honestly ("verified against lint + types; tests
   not run") rather than overclaiming.
5. **Model-provider dependency.** A price change or deprecation is an existential shock. Mitigation: the
   provider abstraction is not architecture astronautics — it is insurance, and it must be exercised
   (two providers working in production from day one, not one plus an interface).
6. **Multi-language support is a treadmill.** Each language needs a grammar, a linter adapter, a test
   runner adapter, and a golden corpus. Mitigation: **go deep on 3 (TypeScript/JavaScript, Python, Go)
   before going wide.** Ten shallow languages is worse than three excellent ones.
7. **Electron distribution friction** on Windows (SmartScreen, antivirus false positives). Mitigation:
   Trusted Signing early, submit to Microsoft/AV vendors for whitelisting before launch.
8. **Team size.** This document describes 9–15 engineer-months of work for one person. The roadmap must
be sequenced so a *usable, sellable* product exists at Milestone 7, not Milestone 12.
</content>

</invoke>
