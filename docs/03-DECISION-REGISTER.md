# Fixora — Decision Register (ADRs)

Every significant technical decision, with **why**, **alternatives considered**, **trade-offs accepted**,
and **long-term impact**. This is the document to argue with.

Statuses: `Accepted` · `Proposed` (needs sign-off) · `Superseded` · `Rejected`

| # | Decision | Status |
|---|---|---|
| [001](#adr-001) | One pipeline, twelve task profiles | Accepted |
| [002](#adr-002) | Deterministic grounding before LLM reasoning | Accepted |
| [003](#adr-003) | Verified repairs via an overlay filesystem | Accepted |
| [004](#adr-004) | Local-first data; the cloud never stores code | Accepted |
| [005](#adr-005) | Electron over Tauri | Accepted |
| [006](#adr-006) | Monaco over CodeMirror 6 | Accepted |
| [007](#adr-007) | No Python runtime in the desktop installer | Accepted |
| [008](#adr-008) | FastAPI for the API — *and the honest case against it* | Accepted |
| [009](#adr-009) | Supabase as an identity provider only; Neon owns the data | Accepted |
| [010](#adr-010) | No Supabase Storage in v1 | Accepted |
| [011](#adr-011) | SQLite via better-sqlite3 for local persistence | Accepted |
| [012](#adr-012) | Provider abstraction with two live implementations from day one | Accepted |
| [013](#adr-013) | Patches as unified diffs; never full-file rewrites | Accepted |
| [014](#adr-014) | SSE over WebSockets for streaming | Accepted |
| [015](#adr-015) | Zustand + TanStack Query + Monaco + SQLite — four state owners, zero overlap | Accepted |
| [016](#adr-016) | Auth via PKCE in the system browser, not an embedded webview | Accepted |
| [017](#adr-017) | Analysis and verification run in isolated utility processes | Accepted |
| [018](#adr-018) | zod-validated IPC as the single renderer↔main boundary | Accepted |
| [019](#adr-019) | Three repositories + one shared token package | Accepted |
| [020](#adr-020) | pnpm + Turborepo monorepo for the desktop app | Accepted |
| [021](#adr-021) | Azure Trusted Signing over an EV certificate | Accepted |
| [022](#adr-022) | Self-hosted release feed, not GitHub Releases | Accepted |
| [023](#adr-023) | Metering and entitlements before the first token is spent | Accepted |
| [024](#adr-024) | Ship 4 capabilities at launch, not 12 | Accepted |
| [025](#adr-025) | Three languages deep, not ten shallow | Accepted |
| [026](#adr-026) | Violet as the single brand accent | Accepted |
| [027](#adr-027) | Server-side kill switches for every AI task profile | Accepted |
| [028](#adr-028) | A scored golden corpus in CI from M5 onward | Accepted |
| [029](#adr-029) | electron-vite as the desktop build tool | Accepted |
| [030](#adr-030) | Design tokens authored in TypeScript; the Tailwind "preset" is a v4 `@theme` layer | Accepted |
| [031](#adr-031) | `docs/adr/` is generated from this register, and CI fails on drift | Accepted |
| [032](#adr-032) | Ladle over Storybook for the component workbench | Accepted |
| [033](#adr-033) | `node:sqlite` instead of better-sqlite3 for local persistence — amends ADR-011 | Accepted |
| [034](#adr-034) | tree-sitter via WebAssembly (web-tree-sitter) with prebuilt grammars | Accepted |
| [035](#adr-035) | Analyzers are workspace-scoped: each tool runs once per analysis, not per file | Accepted |

---

<a id="adr-001"></a>

## ADR-001 — One pipeline, twelve task profiles

**Status:** Accepted

**Decision.** All capabilities (repair, explain, refactor, optimise, secure, document, test-gen,
best-practices, assistant) are the same pipeline — `Ground → Reason → Propose → Verify → Present` —
parameterised by a **task profile**: a system prompt, a context strategy, an output schema, a model
tier, a verification strategy, and a renderer.

**Why.** The brief reads as twelve features. It is one. Treating it as twelve produces twelve
independent prompt/parse/render paths, twelve places for a bug, and twelve things to regress on every
model change. Treating it as one means capability #13 is a config file and a React component.

**Alternatives considered.**

- *Twelve independent feature modules.* Faster to build the first one, catastrophic by the fourth.
  Rejected.
- *A single generic "chat with tools" surface* that lets the model decide what to do. This is what
  Cursor does, and it is exactly the product we must not be — it is unbounded, unverifiable, and
  impossible to price. Rejected as the primary surface; retained as *one* profile (`assistant`).

**Trade-offs accepted.** The abstraction costs ~1.5× the engineering of the first capability, and it
constrains any capability that genuinely does not fit the pipeline shape (we will discover one; when we
do, we extend the pipeline rather than special-case around it).

**Long-term impact.** This is the decision that makes `fixora-cli` and a GitHub Action near-free later,
because the pipeline lives in framework-free packages. It is the highest-leverage decision in the
project.

**Acceptance test.** Adding a new task profile requires **zero** changes to the AI engine, the IPC
layer, or the API. If it doesn't, the abstraction has failed and we stop and fix it.

---

<a id="adr-002"></a>

## ADR-002 — Deterministic grounding before LLM reasoning

**Status:** Accepted

**Decision.** No LLM call is made without *evidence*: findings produced by tree-sitter, the language's
own linter/type-checker, and Semgrep. The model reasons over evidence; it does not go hunting.

**Why.** An LLM asked "find the security vulnerabilities in this file" will find some, whether or not
any exist. False positives in a security tool are not a quality problem, they are an **uninstall
event**. Grounding also makes the product cheaper (smaller prompts), faster (analysis is local and
instant), verifiable (findings have a rule id and a line number), and useful offline.

**Alternatives considered.**

- *Pure-LLM analysis.* Trivial to build, indefensible in production, and identical to fifty other
  products. Rejected.
- *Pure static analysis (no LLM).* This is ESLint. It cannot explain, repair in context, or reason
  across intent. Insufficient alone.

**Trade-offs accepted.** M3 (the analysis engine) is four weeks of work that produces **no AI features**,
which will feel slow. Adapter maintenance across ecosystems is an ongoing tax.

**Long-term impact.** This is the moat. It is also the thing a competitor cannot copy in a weekend.

**Acceptance test.** *Fixora is genuinely useful with the LLM switched off.* If it isn't, the grounding
is decorative and we are a chat wrapper.

---

<a id="adr-003"></a>

## ADR-003 — Verified repairs via an overlay filesystem

**Status:** Accepted

**Decision.** Every proposed patch is applied to a copy-on-write overlay of the workspace, then the
analyzers, the type-checker and (opt-in) the affected tests are re-run. The user sees the fix **and its
verification report**. A patch that fixes finding A but introduces finding B is labelled a *regression*,
not a fix.

**Why.** "The AI suggested this" is worth very little. "This fix compiles, resolves the finding, breaks
no other check, and the 14 affected tests still pass" is worth paying for. This is the single claim that
justifies leaving the editor.

**Alternatives considered.**

- *Trust the model.* Free, and it is what everyone else does. It is also why developers do not trust
  AI fixes. Rejected.
- *Ask the model to self-critique.* Cheap theatre; the model that made the error grades its own work.
  Retained only as a pre-filter, never as the verification.
- *Apply and let CI catch it.* Pushes our failure onto the user's pipeline and their teammates. Rejected.

**Trade-offs accepted.** M6 is the hardest, longest milestone. Running a stranger's test suite reliably
across ecosystems is genuinely hard, and it is arbitrary code execution (on their own machine, from
their own repo — not a privilege escalation, but it must be **opt-in, sandboxed, time-limited, and
killable**). Overlay performance on very large repos requires hardlink-based CoW.

**Long-term impact.** Defines the product. Also defines the marketing. Also defines the north-star
metric (**apply-rate of proposed fixes**).

**Degradation policy.** Verification is *tiered* and we report honestly what ran: static checks always
(cheap, universal) → type-check when a config is detected → tests only when opted in. We say "verified
against lint and types; tests not run" rather than overclaiming.

---

<a id="adr-004"></a>

## ADR-004 — Local-first data; the cloud never stores code

**Status:** Accepted

**Decision.** Sessions, findings, patches, diffs and chat history live in **local SQLite** on the user's
machine. The cloud Postgres holds accounts, subscriptions, entitlements, quota, usage metering and
anonymous telemetry — **never a line of user source code**. The AI gateway is stateless: code passes
through RAM and is never written to disk or database.

**Why.** Our target user is a professional developer bound by an IP policy. The objection _"this thing
uploads my proprietary source"_ kills the sale before any feature matters. Making the honest answer
"your code never leaves your machine except as a transient prompt, and with BYOK not even then" turns
our biggest liability into our strongest differentiator.

**Alternatives considered.**

- *Cloud-stored history (the default SaaS shape).* Enables cross-device sync and server-side analytics
  on real data. It also makes us a breach target holding other companies' source code, requires SOC 2
  before enterprises will touch us, and forces a "we don't train on your data, trust us" conversation we
  cannot win pre-brand. Rejected.
- *Encrypted cloud history with client-side keys.* Real option, and the eventual answer for Teams. But
  it blocks server-side search and adds key-management complexity we do not need in v1. **Deferred**, not
  rejected.

**Trade-offs accepted.** No cross-device history in v1. No server-side product analytics on real code
(we get event-level telemetry only). We must build a local migration system and a local backup story.

**Long-term impact.** Cheaper to run (no code storage, no code egress), faster (analysis is local), and
it opens the enterprise/on-prem path. Retrofitting this later is impossible; building it now is nearly
free.

---

<a id="adr-005"></a>

## ADR-005 — Electron over Tauri

**Status:** Accepted

**Decision.** Electron.

**Why.** Monaco is the product's core surface and it is a Chromium-targeted editor. Electron guarantees
one engine on every OS, which means one set of rendering and performance bugs. Tauri's WebView2/WKWebView
split means we would be debugging Safari-specific Monaco bugs on macOS.

**Alternatives considered.**

- *Tauri.* Installer would be ~10 MB instead of ~90 MB, and memory would be lower. But it introduces a
  Rust surface we cannot currently staff, an inconsistent web engine, and a less mature plugin/updater
  ecosystem. Rejected — **but this is the decision most likely to be revisited**, and it is why
  `core-analysis`, `core-ai` and `core-patch` are pure TypeScript with no Electron dependency: a Tauri
  migration would be a shell rewrite, not a product rewrite.
- *Native (WinUI / Qt).* Best performance, no Monaco, no shared code with the website, no hiring pool.
  Rejected.
- *A VS Code extension instead of an app.* Genuinely tempting — zero distribution friction. But we
  cannot own the verification surface, the diff UX, or the pricing relationship inside someone else's
  editor. **Deferred to M11 as a distribution channel, not a replacement.**

**Trade-offs accepted.** ~90 MB installer, ~200 MB idle RSS, Chromium CVE patch cadence we must track.

**Long-term impact.** Manageable, provided we keep the core packages free of Electron. Enforced by a
lint rule that forbids importing `electron` from `packages/core-*`.

---

<a id="adr-006"></a>

## ADR-006 — Monaco over CodeMirror 6

**Status:** Accepted

**Why.** Monaco's **diff editor** is the product's primary surface and it is excellent, free, and the one
developers already recognise from VS Code. Familiarity is a feature.

**Alternatives considered.** *CodeMirror 6* — smaller, faster, better mobile, cleaner extension model.
But its merge/diff view is weaker, and we would rebuild what Monaco gives us. Rejected.

**Trade-offs accepted.** Monaco is heavy (~5 MB), the worker setup is fiddly, and it historically wants
`unsafe-eval` in the CSP — which we will not grant. We configure Monaco to run without `unsafe-eval` and
CI asserts the CSP has no `unsafe-eval` directive.

**Long-term impact.** Ties us to a Chromium-class engine (see ADR-005). Acceptable.

---

<a id="adr-007"></a>

## ADR-007 — No Python runtime in the desktop installer

**Status:** Accepted

**Decision.** The backend is Python. The desktop app is **not**. All local analysis runs in Node/TS
inside a utility process, using tree-sitter **WASM** grammars. Language tooling the user already has
(`eslint`, `tsc`, `ruff`, `pytest`, `go vet`) is invoked as an optional subprocess **when detected in
the workspace**; nothing is bundled.

**Why.** Embedding CPython in Electron means a ~150 MB installer, per-platform binary wheels, code-signing
every `.pyd`, Windows DLL and PATH conflicts, and a reliable antivirus false-positive. The cost is
enormous and the benefit is zero: tree-sitter has first-class WASM bindings.

**Alternatives considered.**

- *Bundle a Python sidecar (PyInstaller / python-build-standalone).* Rejected on installer size, signing
  cost and support burden.
- *Bundle every linter as a vendored binary.* Rejected — signing and licensing per binary per platform,
  and version skew against the user's own config, which produces findings their CI disagrees with.

**Trade-offs accepted.** If the user's workspace has no ESLint, we fall back to tree-sitter-only analysis
for that language, which is weaker. We must detect and communicate this clearly ("Install ESLint for
deeper analysis") rather than silently degrading.

**Long-term impact.** Keeps the installer under 120 MB and keeps our findings _consistent with the user's
own CI_, which is a correctness property, not just a size one.

---

<a id="adr-008"></a>

## ADR-008 — FastAPI for the API — and the honest case against it

**Status:** **Accepted** — 2026-07-13. The case against was made in full and considered; the founder's
ruling is below, and it is the right one.

**Decision.** The API is **FastAPI / Python 3.12**.

> **Founder's ruling (2026-07-13).** _"Our long-term vision includes advanced static analysis, evaluation
> pipelines, benchmarking, AI experimentation, and ML tooling, where Python provides a stronger ecosystem.
> I prefer accepting the additional complexity now rather than migrating the backend later."_
>
> This is a deliberate trade of **near-term simplicity for long-term optionality**, made with the costs on
> the table rather than discovered later. It is also a stronger version of my own argument: I justified
> Python by the eval harness alone; the ruling correctly extends it to the whole future analysis and ML
> surface. **The decision is closed.** The two-language tax is now a permanent line item, and the mitigations
> below are therefore mandatory rather than nice-to-have:
>
> - The TypeScript API client is **generated from the OpenAPI schema in CI**, never hand-written, and CI
>   fails if the checked-in client differs from what the schema produces (API §5). Contract drift becomes a
>   compile error, not a production incident.
> - Two dependency-audit lanes, two CI pipelines, two lint configs. Budgeted, not resented.
>
> **Revisit only if** we reach M9 having built no Python tooling beyond the API itself — at which point the
> premise of this decision was false and we should say so out loud rather than defend it.

**The honest case against.** Look at what the backend actually does: verify a JWT, check a quota, proxy a
token stream, meter usage, handle Stripe webhooks, serve a release manifest. **None of that needs
Python.** Meanwhile our contracts (`zod`), our core packages, and our client are all TypeScript. A
TypeScript API (Hono/Fastify) would let one zod schema be the literal, shared, compile-time-checked
contract between client and server — eliminating an entire class of drift and the OpenAPI codegen step
along with it. For a small team, one language is a real velocity multiplier.

**Why I am keeping FastAPI anyway.** The highest-leverage thing we build after M6 is the **evaluation
harness** — the scored golden corpus that tells us whether a prompt change made the product better or
worse (ADR-028). Serious eval, dataset, and (later) fine-tuning tooling is Python-native; the TS
equivalents are toys. If Python is already in production, that harness ships as a service. If it isn't,
Python arrives later as "the language we regret", running on someone's laptop. I would rather pay the
two-language tax now, with eyes open, than discover in month nine that our quality loop lives outside
CI. Pydantic v2 gives us schema rigor equal to zod, and **CI generates the TypeScript client from the
OpenAPI schema**, which makes the drift argument moot.

**Trade-offs accepted.** Two toolchains, two dependency audits, two CI lanes, and a codegen step in the
build. Contract drift is prevented by a *generated* client, never a hand-written one.

**Long-term impact.** If we never build serious eval tooling, this decision was wrong and we will feel it
as friction forever. **If you want to overrule me and go TypeScript-everywhere, now is the only free
moment to do it.** Say so before M0.

---

<a id="adr-009"></a>

## ADR-009 — Supabase as an identity provider only; Neon owns the data

**Status:** Accepted

**Decision.** Supabase Auth issues JWTs (email, OAuth, MFA). FastAPI verifies them against Supabase's
**JWKS** endpoint. **Neon** owns every application table, including a `users` row keyed by
`supabase_user_id`, JIT-provisioned on first authenticated request. All authorization happens in the
FastAPI service layer. PostgREST is never exposed. RLS is **not** our security boundary.

**Why.** Supabase Auth is a genuinely good, cheap IdP and building auth ourselves is a waste of a
quarter. But its signature feature — RLS driven by `auth.uid()` — only works if the data lives in
Supabase's own Postgres. Ours lives in Neon. Pretending otherwise is how teams end up with two half-owned
databases and a sync job that silently drifts.

**Alternatives considered.**

- *Supabase Postgres for everything, drop Neon.* Coherent, and RLS becomes usable. Rejected because
  Neon's **branch-per-PR ephemeral databases** are worth more to us than RLS we would bypass anyway
  (all access goes through FastAPI, not the browser).
- *Auth0 / Clerk / WorkOS.* Better enterprise SSO story. More expensive. Revisit at the Teams milestone,
  when SAML becomes a requirement — the JWKS-verification boundary makes swapping the IdP a contained
  change.
- *Roll our own auth.* No.

**Trade-offs accepted.** A webhook-free, JIT-provisioned user table means a user exists in Supabase before
they exist in Neon. Every service must tolerate that ordering. Deleting a user requires a two-system
delete (handled by an erasure job).

**Long-term impact.** The IdP is swappable behind one verification module. That is worth the split-brain
awkwardness.

---

<a id="adr-010"></a>

## ADR-010 — No Supabase Storage in v1

**Status:** Accepted

**Why.** The only things we could store are user code (which ADR-004 forbids) or exported reports (which
belong on the user's disk). A dependency with nothing to store is attack surface, a bill, and an outage
we don't need.

**Alternatives considered.** Using it for crash-report attachments and release binaries. Sentry already
handles the former; release binaries go to object storage behind our own CDN (ADR-022).

**Trade-offs accepted.** None meaningful. **Revisited at Teams**, where shared reports and org artifacts
create a real need — at which point S3-compatible storage (R2) is likelier than Supabase, to keep the
Supabase surface to auth only.

---

<a id="adr-011"></a>

## ADR-011 — SQLite via better-sqlite3 for local persistence

**Status:** Accepted

**Decision.** `better-sqlite3` in the main process, WAL mode, forward-only numbered migrations run inside
a transaction on startup, with a file backup taken before any migration.

**Why.** Synchronous, fastest-in-class, battle-tested, and the main process is not the UI thread so the
synchronous API is a feature (no callback interleaving bugs in migrations).

**Alternatives considered.**

- _`node:sqlite`_ (built into Node 22+). Zero native-module pain and no `electron-rebuild` step —
  genuinely attractive. Rejected for now: still young, and Electron's bundled Node version gates us.
  **Re-evaluate at M8.**
- *sql.js / WASM SQLite.* No native build step, but everything goes through memory and persistence is
  manual. Rejected for a database that must survive a crash.
- *LevelDB / lowdb / JSON files.* We need relational queries over findings and history. Rejected.

**Trade-offs accepted.** A native module means `electron-rebuild` in CI and an ABI pin per Electron
version. This is a known, contained cost.

**Long-term impact.** A corrupted local DB must degrade to "history unavailable", **never** to "the app
won't launch". That is a hard requirement on the startup path.

---

<a id="adr-012"></a>

## ADR-012 — Provider abstraction with two live implementations from day one

**Status:** Accepted

**Decision.** An `AIProvider` interface with **Anthropic and OpenAI both working in production** from M5.
Gemini and Ollama follow.

**Why.** An abstraction with one implementation is a lie we tell ourselves — it will have leaked the first
provider's assumptions into its shape, and we will discover this the day we need to fail over. Two
implementations from the start is what makes the interface *real*. It also gives us live failover when a
provider 429s or degrades, which is an availability feature our users will notice and our competitors
mostly lack.

**Alternatives considered.**

- *One provider, abstract later.* Cheaper now, and the abstraction will be wrong. Rejected.
- *LiteLLM / OpenRouter as the abstraction.* Removes the work, adds a hop, a vendor, and a place for our
  users' code to sit. Rejected on ADR-004 grounds — we will not add a third party to the code path.

**Trade-offs accepted.** ~1 extra week in M5. Two sets of streaming quirks, two token accountings, two
structured-output mechanisms to normalise.

**Long-term impact.** This is insurance against the single largest existential risk in the business
(ADR-023, and see the risk register): a provider price change, deprecation, or outage. It is also what
makes BYOK and local models possible without a rewrite.

---

<a id="adr-013"></a>

## ADR-013 — Patches as unified diffs; never full-file rewrites

**Status:** Accepted

**Why.** Full-file rewrites blow the token budget on large files, destroy the user's formatting and
comments, silently drop code the model didn't think was important, and make review impossible. A unified
diff is reviewable, hunk-stageable, conflict-detectable, and cheap.

**Alternatives considered.**

- *Full-file output.* Simpler to prompt for, much more reliable to parse. And unacceptable in a tool whose
  entire value is trust. Rejected.
- *Structured edit operations (line ranges + replacements).* Precise and token-efficient, but models are
  measurably worse at producing them than at producing diffs, and they aren't human-reviewable. Rejected
  as the wire format; used internally after parsing.

**Trade-offs accepted.** Models produce malformed diffs more often than they produce malformed files. We
mitigate with schema-enforced structured output, a strict parser, one automatic re-ask on parse failure,
and then a loud failure. **Never** a best-effort apply.

**Long-term impact.** Conflict detection by content hash (the file changed on disk since the patch was
generated) is only possible with diffs. This is what makes patch application transactional.

---

<a id="adr-014"></a>

## ADR-014 — SSE over WebSockets

**Status:** Accepted

**Why.** Token streaming is unidirectional. SSE over HTTP/2 gives streaming, trivial cancellation (abort
the request), no stateful connection layer, no sticky sessions, and it works through every corporate proxy
that already allows HTTPS. WebSockets buy us nothing here and cost us load-balancer and scaling complexity.

**Alternatives considered.** *WebSockets* (rejected: bidirectionality we don't need). *Long-polling*
(rejected: worse UX, more load). *gRPC streaming* (rejected: proxy hostility, browser/Electron friction).

**Trade-offs accepted.** SSE has no built-in reconnect-with-resume for a partially consumed AI stream. Our
answer is to treat an interrupted stream as a **cancelled** operation — never a partially applied one.

---

<a id="adr-015"></a>

## ADR-015 — Four state owners, zero overlap

**Status:** Accepted

**Decision.**

- **TanStack Query** owns anything that came over a wire (AI results, entitlements, history queries).
- **Zustand** owns anything the user clicked (panel sizes, active tab, selection, palette state).
- **Monaco models** own text — including the undo stack.
- **SQLite** owns anything that must survive a restart.

**Why.** Every catastrophic frontend codebase I have seen died of the same disease: two sources of truth
for one fact. In particular, mirroring file contents into a store *and* into Monaco is a classic Electron/
Monaco bug — it produces double-writes, lost undo history, and cursor jumps.

**Alternatives considered.** *Redux Toolkit* (ceremony we don't need, and RTK Query is not better than
TanStack Query here). *Jotai/Recoil* (fine, but Zustand's store-per-slice model maps directly onto our
feature slices). *One big store* (rejected on principle).

**Trade-offs accepted.** Four tools to learn instead of one. Worth it.

**Enforcement.** **Any PR that mirrors the same fact across two owners is rejected.** This is in the review
checklist.

---

<a id="adr-016"></a>

## ADR-016 — PKCE in the system browser, never an embedded webview

**Status:** Accepted

**Decision.** Authorization Code + PKCE (S256), opened in the user's **real browser** via
`shell.openExternal`, returned by a `fixora://` deep link, with a **loopback listener fallback**
(`127.0.0.1:<random>`) for locked-down corporate images where protocol registration fails. Refresh token
→ OS keychain via `safeStorage` (DPAPI on Windows). Access token → main-process memory only. **The
renderer never sees a token.**

**Why.** Embedded webviews are blocked outright by Google, and they train users to type credentials into a
window whose origin they cannot verify. The system browser gives us the user's password manager, their
SSO session, and their MFA — all of which raise conversion, not just security.

**Alternatives considered.**

- *Embedded login form / webview.* Rejected: blocked by IdPs, hostile to password managers, phishing-shaped.
- *Device code flow.* Excellent for headless; unnecessarily clunky when we have a browser. Keep it in the
  back pocket for the future CLI.
- *Loopback only (no deep link).* More reliable, slightly worse UX (a stray browser tab). We implement
  **both**, deep link first.

**Trade-offs accepted.** Two redirect mechanisms to build and test. Deep-link registration is unreliable on
some managed Windows images — which is exactly why the fallback is a **deliverable**, not a stretch goal.

---

<a id="adr-017"></a>

## ADR-017 — Analysis and verification run in isolated utility processes

**Status:** Accepted

**Why.** A runaway tree-sitter parse on a 40 MB minified file, a catastrophically backtracking Semgrep
rule, or the user's own `pytest` hanging must not freeze the UI or take down the app. `utilityProcess`
gives us OS-level isolation, hard timeouts, cancellation, and a crash that we can *recover from* by
restarting one process.

**Alternatives considered.** *In the main process* (rejected: one bad parse freezes IPC and the app).
*Web Workers in the renderer* (rejected: no filesystem, no subprocess). *A long-lived child process pool*
(this is effectively what we build; `utilityProcess` is the Electron-native form of it).

**Trade-offs accepted.** IPC serialisation cost across the process boundary, and a more complex lifecycle
(spawn, health-check, restart, backoff).

**Long-term impact.** The verification worker is where we execute *user code*. Having it already isolated
is what lets us tighten that sandbox later (resource limits, filesystem jail) without re-architecting.

---

<a id="adr-018"></a>

## ADR-018 — zod-validated IPC as the single renderer↔main boundary

**Status:** Accepted

**Decision.** Every channel is declared once as a zod request/response schema pair. The router validates
**both directions** at runtime. The preload exposes a single frozen object built from that registry.
`ipcRenderer` is never handed to the renderer.

**Why.** The renderer is a browser. It runs a large dependency tree and an editor that renders untrusted
content (the user's code). **Treat it as hostile.** A validated, enumerable IPC surface is the difference
between "a renderer compromise is contained" and "a renderer compromise reads `~/.ssh`".

**Alternatives considered.** *tRPC over IPC* (elegant, adds a dependency and a layer; the registry pattern
gives us the same type safety in ~200 lines). _Hand-rolled `ipcMain.handle` calls_ (rejected: unenumerable
surface, no validation, this is how Electron apps get CVEs).

**Trade-offs accepted.** Boilerplate per channel, and runtime validation cost (negligible relative to the
work each handler does).

**Non-negotiable companion rule.** Every handler that touches a path re-canonicalises it and asserts it is
inside the open workspace root, **after** resolving symlinks. Path traversal is the #1 realistic exploit in
a tool that reads local files.

---

<a id="adr-019"></a>

## ADR-019 — Three repositories + one shared token package

**Status:** Accepted

**Decision.** `fixora-desktop` (monorepo), `fixora-api`, `fixora-web` — independent, as specified. Plus
**`@fixora/tokens`**, a tiny published package containing the design tokens, consumed by both the desktop
app and the website.

**Why.** The repos have genuinely different release cadences (the app ships fortnightly and signed; the
site ships hourly). But two repos with hand-copied colours means brand drift within a month. One published
token package is the minimum shared surface that prevents it.

**Alternatives considered.** *One giant monorepo for everything* (couples release cadences, makes CI slow
and permissions coarse; rejected). *Full duplication with no shared package* (rejected: brand drift is
inevitable and expensive to unwind).

**Trade-offs accepted.** A publish step, and version coordination when tokens change.

---

<a id="adr-020"></a>

## ADR-020 — pnpm + Turborepo for the desktop monorepo

**Status:** Accepted

**Why.** pnpm's strict, non-hoisted `node_modules` prevents phantom dependencies — which matter enormously
here, because a `packages/core-analysis` that accidentally resolves `electron` through hoisting would
silently violate ADR-005's escape hatch. Turborepo gives us cached, parallel task graphs so CI stays under
five minutes.

**Alternatives considered.** *npm workspaces* (hoisting = phantom deps; rejected). *Nx* (more powerful,
more machinery than we need). *Yarn Berry PnP* (breaks native modules and Electron tooling; rejected).
*No monorepo* (rejected: the core packages must be separately versioned and testable).

**Trade-offs accepted.** pnpm + native modules + Electron requires explicit configuration
(`node-linker`/hoisting rules for `better-sqlite3`). Known, contained.

---

<a id="adr-021"></a>

## ADR-021 — Azure Trusted Signing over an EV certificate

**Status:** Accepted

**Why.** ~$10/month against $300–500/year for a traditional EV certificate, no hardware token in a drawer,
and it inherits Microsoft's SmartScreen reputation **immediately** — so our first user does not see
"Windows protected your PC". That dialog is a conversion cliff, and for an unknown brand it is the single
biggest install-funnel leak.

**Alternatives considered.** *EV cert on a hardware token* (expensive, awkward in CI, and the token is a
single point of failure). *OV cert* (cheap, but SmartScreen reputation must be earned from zero over
weeks/thousands of installs — unacceptable at launch). *Unsigned* (not a serious option for a commercial
desktop product).

**Trade-offs accepted.** Ties signing to an Azure account and its identity-validation process (which takes
days — **start it in M0, not M8**).

---

<a id="adr-022"></a>

## ADR-022 — Self-hosted release feed, not GitHub Releases

**Status:** Accepted

**Decision.** `electron-updater` points at a manifest served by **our own API**, backed by a `releases`
table with a `rollout_percent`. Binaries live in object storage behind a CDN.

**Why.** A raw GitHub Releases feed gives us no **staged rollout** and no **kill switch**. Desktop clients
in the wild cannot be hot-fixed; the only defence against a bad release is to stop it reaching everyone.
We promote 5% → 25% → 100%, watching crash-free-sessions between steps, and we can halt instantly.

**Alternatives considered.** *GitHub Releases* (free, zero infra, no rollout control — rejected).
*Hazel/Nuts* (a proxy over GitHub; still no rollout control). *A commercial update service* (money for
something that is a database table and an endpoint).

**Trade-offs accepted.** We own the availability of our own update feed. It must be boringly reliable: a
static manifest, cached at the CDN, with the API only computing rollout eligibility.

---

<a id="adr-023"></a>

## ADR-023 — Metering and entitlements before the first token is spent

**Status:** Accepted

**Decision.** `entitlements`, `usage_events` and quota enforcement ship in **M4**, before the AI layer in
M5. The client is untrusted; quota is enforced server-side. **We never ship an "unlimited" plan.**

**Why.** In an AI product, a power user on a flat plan can cost more in tokens than they pay. Retrofitting
metering after launch means either a painful migration or eating the loss. Building it first costs days;
building it later costs the business.

**Alternatives considered.** *Meter later.* Universally regretted. Rejected.
*Client-side quota.* The client is a JavaScript app on the user's machine. It is not a security boundary.
Rejected.

**Trade-offs accepted.** M4 lands before any AI feature is demoable, which will feel like slow progress.

**Long-term impact.** BYOK (ADR-004) is the pressure valve: heavy users bring their own key, which
simultaneously solves our cost problem and their privacy problem. This is the rare alignment where the
right business decision *is* the right ethical one — build for it.

---

<a id="adr-024"></a>

## ADR-024 — Ship 4 capabilities at launch, not 12

**Status:** **Accepted** — 2026-07-13. Signed off by the founder, overriding the original brief.
_"Let's launch with the four core capabilities: Repair, Explain, Security, and Test Generation. The
remaining capabilities can be released after they reach the same quality bar."_

**Decision.** v1.0 ships **Repair, Explain, Security, and Test Generation** at an excellent quality bar.
Refactor, Optimise, Document, Best-Practices, Compare and Assistant are built on the same pipeline and
released *incrementally, after launch, each gated on its own golden-corpus score.*

**Why.** Every capability needs its own golden corpus, its own quality bar, and its own verification
strategy. Twelve buttons shipped simultaneously means twelve mediocre ones — and **a mediocre "Optimise"
button destroys the user's trust in the excellent "Repair" button.** Trust is not per-feature; it is
per-product. In a tool whose entire thesis is *trust*, shipping a feature below the bar is worse than not
shipping it.

The four chosen are the ones that (a) are grounded in deterministic evidence, so we can be *right*, and
(b) map to the moments a developer actually opens a fixing tool: *it's broken*, *I don't understand it*,
*is this safe to ship*, *I need coverage before I touch this*.

"Optimise" is the weakest of the twelve, incidentally — real performance work needs a profiler and a
benchmark, not a language model reading a function. When we ship it, it should be grounded in an actual
benchmark harness, or not at all.

**Alternatives considered.** *Ship all twelve.* Bigger feature list on the pricing page, worse product,
slower launch by ~8 weeks, and it puts our trust thesis at the mercy of our weakest feature. Rejected.

**Trade-offs accepted.** A shorter feature list at launch, and the marketing site can no longer say
"twelve things". It can say "four things that work", which is a better ad anyway.

**Long-term impact.** None, architecturally — ADR-001 means the remaining eight are config, not code.
This is purely a *release sequencing* decision, which is why it costs nothing to accept and everything to
get wrong.

---

<a id="adr-025"></a>

## ADR-025 — Three languages deep, not ten shallow

**Status:** Accepted — 2026-07-13

**Decision.** **TypeScript/JavaScript, Python, Go** at launch. Each with: a tree-sitter grammar, linter +
type-checker adapters, a Semgrep ruleset, a test-runner adapter, and a golden corpus.

**Why.** Each language is not a checkbox — it is five integrations and an evidence corpus. Ten languages at
50% quality is worse than three at 95%, because a developer evaluates us on *their* language and leaves
forever if we are bad at it. TS/JS is the largest market, Python is the AI-adjacent market, Go has the
cleanest tooling story (a single official toolchain, fast tests) which makes it the cheapest third.

**Alternatives considered.** *Ten languages via tree-sitter only, no linter adapters.* This gets us
"supports 10 languages" on the pricing page and violates ADR-002 in nine of them. Rejected — it is
precisely the shortcut that turns us into a chat wrapper.

**Trade-offs accepted.** Java, C#, Rust, PHP, Ruby users bounce. We tell them honestly on the site, with a
"vote for your language" capture — which is free market research.

---

<a id="adr-026"></a>

## ADR-026 — Violet as the single brand accent

**Status:** Accepted — 2026-07-13

**Why.** The approved design has three accent signals (violet ambient glow, blue CTA, blue-ish mark) — that
is three brands. The violet glow is the element that makes the page feel expensive, and blue is the default
colour of every developer tool on earth. One tuned violet scale, with all interactive states derived from
it, and semantic status colours (danger/warn/success/info) held separate and never used decoratively.

**Trade-offs accepted.** Violet at low luminance on near-black is harder to keep above 4.5:1 for text — so
violet is used for *surfaces and accents*, and text on violet is checked by the CI contrast gate, not by
eye.

---

<a id="adr-027"></a>

## ADR-027 — Server-side kill switches for every AI task profile

**Status:** Accepted

**Why.** A desktop client in the wild **cannot be hot-fixed**. If a prompt change or a provider regression
makes the `security` profile start emitting nonsense, our only options are (a) ship an update and wait days
for adoption, or (b) turn it off from the server. (b) must exist from M5.

**Implementation.** Every task profile is gated by a server-side flag returned with the entitlement
payload. A disabled profile renders as "temporarily unavailable" with a reason, not as a broken button.

**Trade-offs accepted.** The app is degraded-but-working when offline (local analysis only), and it must
cache the last known flag set so a network blip does not disable features.

---

<a id="adr-028"></a>

## ADR-028 — A scored golden corpus in CI from M5 onward

**Status:** Accepted

**Decision.** A corpus of real broken files with known-correct fixes, scored automatically on every change
to a prompt, a context strategy, a model version, or a task profile. Score = _did it resolve the target
finding, did it introduce a new one, do the tests still pass, how many tokens did it cost_.

**Why.** In an AI product, the prompt, the context builder and the model are **code that can regress with
no compile error and no failing unit test**. Without a scored corpus, we are flying blind and our quality
will drift downward invisibly while everyone feels productive. This is the single practice that separates
AI products that improve from AI products that rot.

**Alternatives considered.** *Manual spot-checking.* Does not scale past week three and is not a gate.
*LLM-as-judge only.* Useful as a *secondary* signal, but our primary signal is objective and free: **did
the verification pass?** We already built that in M6 — the corpus scorer is the verification pipeline run
in a loop. That is a beautiful piece of leverage and we should exploit it deliberately.

**Trade-offs accepted.** Corpus curation is ongoing, unglamorous work. It is also the most valuable asset we
will own after the product itself.

---

<a id="adr-029"></a>

## ADR-029 — electron-vite as the desktop build tool

**Status:** Accepted — 2026-07-13 (M0)

**Decision.** Build the desktop app with **electron-vite**, not a hand-rolled Vite + tsc + electron-builder
script chain, and not Electron Forge + webpack.

**Why.** Electron has three build targets with three different contracts — `main` (Node, CJS), `preload`
(Node, CJS, sandbox-constrained), `renderer` (browser, ESM). electron-vite models all three as first-class,
with the correct externalisation and HMR defaults for each. Rolling our own means owning three configs and
the interop between them — work that buys nothing and breaks quietly. It is also what let the M0 audit find
the preload's 120 kB zod bloat, because per-target bundle output is a thing you can actually inspect.

**Alternatives considered.**

- _Electron Forge + webpack._ Heavier, slower, and webpack is a step backwards from Vite for the renderer.
  Rejected.
- _Hand-rolled Vite + tsc + electron-builder._ We would rebuild electron-vite, worse and unmaintained.
  Rejected.

**Trade-offs accepted.** It pins us to Vite 7 (electron-vite 5 does not yet peer Vite 8). Contained: Vitest 4
supports Vite 7, so there is no split in the test toolchain. Re-evaluate when electron-vite peers Vite 8.

**Long-term impact.** Low. The build tool sits at the edge; the core packages are framework-free and do not
depend on it. Swapping it later is a config change, not a product change.

---

<a id="adr-030"></a>

## ADR-030 — Design tokens authored in TypeScript; the Tailwind "preset" is a v4 `@theme` layer

**Status:** Accepted — 2026-07-13 (M0)

**Decision.** Author the design tokens as **TypeScript** in `packages/tokens/src`, and build them to (a)
`tokens.css` — semantic CSS custom properties for light and dark, (b) `theme.css` — a Tailwind **v4
`@theme`** layer, (c) typed JS exports. Both CSS files are consumed by the desktop app and, later, the
website.

**Why.** The roadmap's M0 deliverable says "Tailwind preset". **Tailwind v4 removed JS presets** — the theme
_is_ CSS now (`@theme`). `theme.css` is the v4-shaped equivalent of a preset, and it is importable by both
repos, which is all ADR-019 actually requires of the shared token surface. Authoring the tokens in
TypeScript rather than JSON (or a Style Dictionary pipeline) is what lets the **contrast gate import the
palette directly and typecheck it** — a token that is not a typed value is a token the gate cannot see, and
the gate is the entire point (Design Review §6.3). The gate earned this on its first run, rejecting eight
colour pairs including violet-500.

**Alternatives considered.**

- _JSON tokens + Style Dictionary._ The industry-standard pipeline. Rejected for v1: it puts the tokens
  behind a build step the contrast gate would have to parse rather than import, and it is more machinery
  than a single-brand, two-consumer system needs. Revisit if a third consumer or multi-brand theming
  arrives.
- _Hand-written CSS variables._ No type safety, no gate, brand drift by month two. Rejected.

**Trade-offs accepted.** A small hand-written build script (~120 lines) instead of an off-the-shelf token
pipeline. It does exactly what we need and nothing more, and its output is asserted consistent by a test
(`css-consistency.test.ts`, added in the M0 audit after a dangling-reference bug).

**Long-term impact.** The tokens are the one brand surface shared across repos (ADR-019). Keeping them typed
and gated is what makes "our palette is WCAG-clean" a fact the build enforces rather than a claim we make.

---

<a id="adr-031"></a>

## ADR-031 — `docs/adr/` is generated from this register, and CI fails on drift

**Status:** Accepted — 2026-07-13 (M0)

**Decision.** The individual ADR records under `docs/adr/` are **generated** from this register by
`tooling/scripts/sync-adrs.ts`. `pnpm gate:adr` fails the build if they diverge. This register remains the
single source of truth; `docs/adr/` is a projection of it, addressable per decision.

**Why.** The roadmap's M0 deliverable asks for "every decision in the architecture doc gets a numbered
record". The obvious implementation — hand-copying each decision into its own file — creates **two sources
of truth for one fact**, which is the exact disease ADR-015 rejects for application state. The register and
the copies drift within a month, and nobody knows which one the team actually decided. Generation makes
drift impossible rather than merely discouraged.

**Alternatives considered.**

- _Hand-authored ADR files, register as an index._ The conventional layout. Rejected: the index and the
  files drift, and the drift is invisible until someone cites the stale one in a design argument.
- _Only the register, no per-file records._ Loses the ability to link, cite and diff a single decision, and
  does not satisfy the M0 deliverable. Rejected.

**Trade-offs accepted.** A generator and a CI gate to maintain (~130 lines, one blocking check). Editing a
file in `docs/adr/` directly does not change a decision — it breaks the build, which is the correct response
to someone trying to change a decision by editing a copy of it.

**Long-term impact.** The decision record cannot rot into inconsistency. As the register grows, the records
stay in lockstep for free.

---

<a id="adr-032"></a>

## ADR-032 — Ladle over Storybook for the component workbench

**Status:** Accepted — 2026-07-14 (M1)

**Decision.** Use **Ladle** for the primitive component workbench (the roadmap's M1 deliverable says
"Storybook or Ladle"), not Storybook.

**Why.** Ladle is Vite-native and shares our exact toolchain — Vite 7, the `@tailwindcss/vite` plugin,
React 19 — so a primitive renders in the workbench through the same pipeline it renders through in the app,
and the token CSS + contrast-gated colours are the ones on screen. It is a fraction of Storybook's
dependency weight and config surface, starts in a second, and has no separate build system to keep aligned
with the app's. Storybook 8 would bring its own Webpack/Vite-builder abstraction, an addon ecosystem we do
not need, and hundreds of transitive dependencies — each one a supply-chain trust decision (Standards §2)
for a **dev-only** tool that never ships in the binary.

**Alternatives considered.**

- _Storybook._ The default choice, with a larger addon ecosystem (interaction tests, a11y panel). Rejected
  for v1: the weight and the second toolchain are not worth it when our a11y bar is already enforced by
  axe-core in the unit tests and our theming already lives in the shared token layer. Revisit only if we
  need Storybook-specific addons we cannot reproduce.
- _No workbench (rely on the running app)._ Rejected — a primitive needs to be reviewable in isolation,
  across variants, themes and densities, without booting the whole Electron app.

**Trade-offs accepted.** A smaller addon ecosystem, and Ladle is a younger project than Storybook. Contained:
stories are dev tooling, the build output is git-ignored, and switching to Storybook later would be a
config change local to `packages/ui`, touching no product code.

**Long-term impact.** Low and local. The workbench sits beside the ui package; nothing depends on it.

---

<a id="adr-033"></a>

## ADR-033 — `node:sqlite` instead of better-sqlite3 for local persistence (amends ADR-011)

**Status:** Accepted — 2026-07-14 (M2). **Amends ADR-011**, which chose better-sqlite3 and explicitly
flagged `node:sqlite` as "genuinely attractive… re-evaluate at M8". The re-evaluation happened at M2, forced
by a real constraint, and the answer changed.

**Decision.** Use **`node:sqlite`** (the SQLite module built into the Node runtime Electron bundles) as the
local database driver, behind a thin `SqliteDriver` interface, rather than the native `better-sqlite3`
module. Everything else ADR-011 committed to stands: WAL mode, forward-only numbered migrations in a
transaction with a file backup taken first, and a corrupted DB degrading to "history unavailable" rather
than blocking launch (DB §1).

**Why the change, now.** better-sqlite3 is a native module. Electron 43 uses Node ABI **v148**, and
better-sqlite3 12.11.1 publishes **no prebuilt binary** for it (a 404 on the release asset), so it must be
compiled with node-gyp — which needs a C++ toolchain (Python + MSVC) that is not present, and cannot be
assumed present on every contributor or CI machine without adding it as a hard prerequisite. This is
precisely the "native-module pain… PATH/DLL hell… antivirus false-positive magnet" ADR-007 warned about for
*bundled* runtimes, arriving through the database driver.

`node:sqlite` sidesteps all of it: it is part of Electron's own runtime, so there is **nothing to compile,
no ABI to pin, no electron-rebuild step, and no prebuild to wait for** when Electron updates. It was verified
working in Electron 43 (Node 24.18.0) with no flag: create/insert/select round-trips. ADR-011's two reasons
for deferring it — "still young" and "Electron's bundled Node version gates us" — are both now resolved:
Node 24 ships it stable and unflagged, and that is exactly the Node that Electron 43 gates us to.

**Alternatives considered.**

- _Keep better-sqlite3, add a build toolchain as a prerequisite._ Rejected: it makes a C++ compiler a
  hard dependency of building the app, on every machine, forever, to gain nothing over a driver already in
  the runtime. It also reintroduces the "rebuild on every Electron bump" tax ADR-011 acknowledged.
- _WASM SQLite (sql.js)._ Still rejected on ADR-011's own grounds — in-memory with manual persistence, unfit
  for a store that must survive a crash.
- _Wait for a better-sqlite3 Electron-v148 prebuild._ Rejected: it blocks M2 on an upstream release, and the
  same wait recurs at every Electron upgrade.

**Trade-offs accepted.** `node:sqlite`'s API differs from better-sqlite3's (e.g. `DatabaseSync`,
`.prepare().run/get/all`), so the driver is wrapped behind a `SqliteDriver` interface — which we would want
regardless, because it keeps the persistence layer testable and keeps the door open to swapping back to
better-sqlite3 (or to a WASM build for a future web target) without touching a repository. `node:sqlite` is
newer than better-sqlite3 and has a smaller battle-tested history; the interface and our own migration/
integrity tests are the mitigation. In Node's test suite it is no longer marked experimental as of Node 24.

**Long-term impact.** Removes a native build step from the desktop app entirely — no `electron-rebuild`, no
per-ABI prebuild coordination, no compiler prerequisite. The `SqliteDriver` seam is the insurance that makes
this reversible if `node:sqlite` ever disappoints.

<a id="adr-034"></a>

## ADR-034 — tree-sitter via WebAssembly (web-tree-sitter) with prebuilt grammars

**Status:** Accepted — 2026-07-16

**Decision.** The analysis engine parses with **`web-tree-sitter`** (tree-sitter compiled to WebAssembly),
loading **prebuilt grammar `.wasm`** for TypeScript/JavaScript, Python and Go from `tree-sitter-wasms`. No
native tree-sitter bindings, no compile step.

**Why.** The same reasoning as ADR-005 (Electron over Tauri: no C++ toolchain in the build) and ADR-033
(`node:sqlite`: use the runtime, don't compile a native module). Native `tree-sitter` bindings would
reintroduce `node-gyp`, a per-ABI rebuild on every Electron bump, and a compiler prerequisite on every
machine — for a parser. WASM grammars are data we ship; loading them needs only the WASM runtime the engine
already carries. The engine stays pure-TS and runs unchanged in a CLI, a CI action, and the test harness
(TDD §2), which is where its per-language conformance tests live.

**Alternatives considered.** _Native `tree-sitter` + `node-gyp`_ — rejected: the native-build tax ADR-005/033
exist to avoid. _Regex/hand-rolled parsing_ — rejected: not real symbol/scope/call-graph extraction, and
unmaintainable across three languages. _One grammar (TS only)_ — rejected: violates ADR-025 (three deep).

**Trade-offs accepted.** WASM parsing is somewhat slower than native (irrelevant at file scale, and it runs
in the isolated utility process, ADR-017, so it can never freeze the UI). The `.wasm` assets must ship and be
**unpacked from the ASAR** at packaging (M8) since tree-sitter reads them as files; `tree-sitter-wasms` is a
runtime dependency for that reason. The WASM lifecycle (init once, load each grammar once, dispose trees) is
wrapped so the rest of the engine never touches it.

**Long-term impact.** Adding a language is adding a grammar `.wasm` + a query set + conformance tests — no
build-system change. The isolation (ADR-017) means even a runaway parse on a 40 MB minified file is a killed
worker, not a hung app.

<a id="adr-035"></a>

## ADR-035 — Analyzers are workspace-scoped: each tool runs once per analysis, not per file

**Status:** Accepted — 2026-07-16

**Decision.** An analyzer's `run(context)` is invoked **once per analysis**, over the whole set of files.
External-tool adapters spawn their tool a **single time** (`eslint .`, `tsc --noEmit`, `go vet ./...`,
`ruff check .`, `mypy .`, `semgrep scan .`) and distribute the findings across their files; the tree-sitter
complexity analyzer iterates the files itself. A shared per-run symbol cache parses each file once no matter
how many tools report in it.

**Why.** The type-checkers and vetters are inherently **project-scoped** — `tsc`/`mypy`/`go vet` need the
whole program to resolve a type or a package. Invoking them once *per file* is O(files × project): a real
repo re-runs the entire type-checker for every file and never finishes. Running each tool once is not only
orders of magnitude faster, it is **exactly the invocation the user's CI runs** — so our findings match their
CI by construction (the ADR-002/ADR-007 acceptance test), rather than approximating it.

**Alternatives considered.** _Per-file invocation with a cache_ (the first cut) — rejected: the cache keyed on
file content, which does nothing for a project-wide tool whose result is the same call regardless of which
file triggered it; the quadratic blow-up remained. _A separate "project analyzer" interface_ — rejected as
unnecessary surface: one workspace-scoped `run()` covers both the file-iterating analyzer (complexity) and
the once-per-workspace tools, and keeps the engine a single loop.

**Trade-offs accepted.** Incremental analysis is coarser: a file change re-runs the workspace analysis, not
just that file. Acceptable for M3 (analysis is user-triggered), and a future incremental mode can re-run only
the file-scoped analyzers for a changed file while reusing the last project-tool result. The worker collects
findings and posts them grouped by file, so a very large result set is buffered before the first paint —
bounded in practice, and a candidate for streaming later.

**Long-term impact.** This is the decision that makes the engine usable on a real codebase. It also fixes the
grounding contract: because each tool is the user's own tool run their own way, "matches your CI" is a
property of the architecture, not a hope.

<a id="adr-036"></a>

## ADR-036 — Ship a BYOK-first Public Beta; defer the managed tier to v1.1

**Status:** Accepted — 2026-07-16

**Decision.** The Public Beta is **bring-your-own-key only**. AI runs desktop → provider directly (OpenRouter
first, with OpenAI/Anthropic/Google reachable through it) using a key the user stores in their OS keychain.
There is **no account, no sign-in, and no Fixora server on the AI path** in the beta. The managed tier — the
`fixora-api` gateway (Supabase auth, quota, entitlements, metering) and the desktop PKCE sign-in — is built,
green, and **deferred to v1.1**, ready to switch on. Revenue at launch is a **Stripe Payment Link + an offline
license key** (ADR-038-adjacent), not a billing backend.

**Why.** The mission became: ship a trustworthy beta this month. BYOK inverts what the beta needs — with the
user's own key there is nothing to meter, so the entire account/quota/billing backend leaves the critical
path. That makes the beta smaller, faster to ship, and **more private** (nothing but the provider call leaves
the machine), which is the product's whole thesis. The managed work is not wasted; it is the v1.1 tier.

**Alternatives considered.** _Finish the managed tier first_ — rejected: it is the slow path and puts our
provider cost + a billing integration in front of a beta that does not need them. _Optional sign-in in the
beta_ — rejected: cost now, little beta benefit. _Managed AI (our keys) in the beta_ — rejected: most work,
needs the backend deployed + Stripe, and puts our token spend on the critical path.

**Trade-offs accepted.** Beta users must obtain their own OpenRouter key (a documented one-time step). No
server-side usage analytics in the beta (acceptable; the point is privacy). The deferred backend must be
kept building so v1.1 can turn it on without rot.

**Long-term impact.** The provider abstraction (ADR-012) stays; the beta ships one adapter and gains the
others by architecture. When the managed tier turns on, the client's transport switches from BYOK-direct to
the gateway behind the same interface — no client rewrite.

<a id="adr-037"></a>

## ADR-037 — A repair emits a replacement symbol; Fixora derives the diff and applies by verified range

**Status:** Accepted — 2026-07-17 — refines ADR-013

**Decision.** The model returns, under a strict JSON schema, the **full replacement text for the target
symbol** (plus rationale + confidence) — not a unified diff. Fixora computes the diff deterministically
(original symbol vs. replacement) for the diff viewer, and applies by **replacing the target line range**.
Apply carries the exact original text the range held at proposal time and is **refused if the file changed
since** (the range would be stale).

**Why.** A model-authored unified diff is a source of silent corruption: fuzzy hunk headers, mismatched
context, off-by-one line numbers — in a system that writes to people's source files. Having the model return
the replacement symbol and computing the diff ourselves makes malformed diffs **impossible**, makes apply a
**deterministic range replacement** rather than a fuzzy patch, and still honours ADR-013's intent — surgical,
reviewable, **never a whole-file rewrite** (the unit is the enclosing symbol). It composes cleanly with the
grounding: the target range comes from the finding's own enclosing symbol (tree-sitter), so we always know
exactly what to replace.

**Alternatives considered.** _Model emits a unified diff (ADR-013 literal)_ — retained as the *presented*
artifact (we still show a diff) but rejected as the *transport*: parsing model diffs reliably across
languages is a tar pit. _Whole-file replacement_ — rejected: violates ADR-013 and buries the change.

**Trade-offs accepted.** The model must return the whole symbol even for a one-line fix (a few more output
tokens; trivial and bounded by the symbol). A repair that needs to change *two* symbols is out of scope for
the beta (one target per repair) — a deliberate limit, not a gap.

**Long-term impact.** Apply is transactional and safe by construction (verified range + stale-guard), which
is what lets "Apply" be a one-click action the user trusts. Multi-symbol / cross-file repairs are a v1.1
extension behind the same "replacement + verify" model.

<a id="adr-038"></a>

## ADR-038 — A local, private repair-history audit trail

**Status:** Accepted — 2026-07-18

**Decision.** Every repair the user reviews is recorded in **local SQLite** (migration v4) with its
verification verdict, the model, the **before/after code**, and whether it was applied. A History panel lists
the trail. It is local-only and never leaves the machine.

**Why.** The product's claim is "trust us with your code." An audit trail the user can **inspect** — exactly
what the AI proposed, what it was verified against, and what they accepted — turns that claim into something
checkable. The local/cloud code-retention line (DB §1) is a hard, tested boundary: the **cloud** schema
forbids code/paths/diffs, but **local** SQLite is meant to hold everything about the user's code, so storing
the before/after text is not only allowed, it is what makes "review a past fix / copy it again" work.

**Alternatives considered.** _Record only a verdict + metadata_ — rejected: without the code, the history
cannot show what changed or let the user re-use a past fix. _Record applied repairs only_ — rejected: a
regressed or unresolved attempt is part of the audit too; recording all reviewed repairs is the honest trail.
_Store in the cloud_ — rejected outright: it is the user's code; it stays on their machine (ADR-004).

**Trade-offs accepted.** History grows with use (bounded per workspace; a clear/retention control is a later
refinement). No cross-device history in the beta (it is local — consistent with BYOK-first, ADR-036).

**Long-term impact.** The trail is the substrate for later product surfaces (apply-rate metrics — the ADR-003
north-star — computed locally; export; "undo a past apply"), and it is where a v1.1 opt-in sync would attach
if the user ever wants it.

