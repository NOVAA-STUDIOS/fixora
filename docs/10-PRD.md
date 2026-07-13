# Fixora — Product Requirements Document

**Version** 1.0 · **Status** Awaiting sign-off · **Owner** Founding team

---

## 1. Problem

A developer's day contains two very different activities, and the industry has only built tools for one.

**Writing code** is well served: Copilot, Cursor, Windsurf and Zed all autocomplete, generate and chat
inside the editor. **Fixing code is not.** When something is already broken — a failing test, a
production bug, a security finding, a slow endpoint, a file inherited from someone who left — the
developer's toolkit is still: read the stack trace, grep, guess, change something, run the tests, repeat.

The AI tools that _claim_ to help here mostly do not, for one reason: **they cannot be trusted.**

- They hallucinate findings, because they hunt for bugs instead of reasoning over evidence.
- They propose fixes they have not run, cannot verify, and will not stand behind.
- They want your proprietary source code uploaded to a service you have never audited.

So the fix gets suggested, the developer reads it, does not trust it, and writes their own. The tool
saved nothing.

**Fixora's bet:** the bottleneck is not _generating_ a fix. It is _trusting_ one.

---

## 2. Vision

> **Fixora is the workspace you open when the code is already broken.**
>
> It finds the bug with real static analysis, explains it in plain language, writes the fix as a
> reviewable diff, **proves the fix works before you see it**, and never sends your code anywhere you
> didn't approve.

**Positioning:** _Cursor is where you write code. Fixora is where you fix it._

**The three promises** (every one is falsifiable, and every one is an engineering commitment):

1. **Grounded** — every finding has a rule, a line, and evidence. We do not guess.
2. **Verified** — every fix has been applied, re-checked and re-tested before it reaches you.
3. **Private** — your code lives on your machine. With BYOK, our servers never see it at all.

---

## 3. Users

### Persona 1 — "Priya", Senior Backend Engineer at a 200-person SaaS company _(primary)_

Ships Python and Go. Bound by an IP policy that forbids pasting source into external services. Skeptical
of AI tools because she has been burned by confidently wrong suggestions. Will pay for a tool herself if
it is genuinely good; will champion it internally if it passes her security team.
**What wins her:** the verification report. **What loses her:** one hallucinated security finding.

### Persona 2 — "Marcus", Full-stack developer at a 12-person startup _(primary)_

TypeScript, moves fast, inherited a codebase with no tests and no docs. Wears the security hat by
default and knows he shouldn't. Cost-sensitive; on the free tier until Fixora saves him a bad afternoon.
**What wins him:** test generation and "explain this file I've never seen". **What loses him:** slowness.

### Persona 3 — "Dana", Engineering Manager _(economic buyer, later)_

Doesn't code daily. Buys tools that reduce escaped defects and onboarding time. Needs an answer to
"where does our code go" before she can sign anything.
**What wins her:** the security page, seats, and a CI integration that comments on PRs.

### Explicit non-user

The developer looking for an autocomplete or a chat assistant. That is not us and we will not chase them.
Trying to be Cursor is the fastest way to be a worse Cursor.

---

## 4. Jobs to be done

| When…                                  | I want to…                                    | So that…                                                  | Capability                       |
| -------------------------------------- | --------------------------------------------- | --------------------------------------------------------- | -------------------------------- |
| A test is failing and I don't know why | Understand the actual cause, not a guess      | I fix the bug, not the symptom                            | Repair                           |
| I open a file I've never seen          | Understand what it does and where the risk is | I can change it without fear                              | Explain                          |
| I'm about to ship                      | Know if I've introduced a vulnerability       | I don't get paged at 2am                                  | Security                         |
| I need to refactor untested code       | Get meaningful tests first                    | I have a safety net                                       | Test Generation                  |
| An AI proposes a fix                   | Know that it actually works                   | I can approve it in seconds, not audit it for ten minutes | **Verification (cross-cutting)** |

---

## 5. Scope

### 5.1 v1.0 — four capabilities, not twelve _(see ADR-024)_

I am formally recommending we **cut the launch scope from twelve capabilities to four.**

**Ship at v1.0:**

1. **Repair** — grounded finding → explanation → reviewable diff → verification report → hunk-level apply → undo.
2. **Explain** — file-, function- and finding-level explanation, grounded in the symbol graph.
3. **Security** — Semgrep-grounded vulnerability findings with LLM-authored explanation and fix.
4. **Test Generation** — generate tests for a target symbol; **the generated tests must pass in the
   verification sandbox before we show them.** (A generated test that fails is not a feature, it is a chore.)

**Build the pipeline for, ship after launch (each gated on its own golden-corpus score):**
Refactor · Optimise · Document · Best-practices · Compare/Diff-review · Grounded Assistant · Project History search

**Why.** Every capability needs its own evidence source, quality bar and corpus. Twelve buttons shipped at
once means twelve mediocre ones, and **a mediocre "Optimise" button destroys trust in an excellent
"Repair" button.** Trust is per-product, not per-feature. In a product whose entire thesis is trust,
shipping below the bar is worse than not shipping.

Architecturally this costs **nothing** — ADR-001 means the other eight are task profiles, not code. This is
purely release sequencing. It buys us ~8 weeks and a defensible launch.

Note on **Optimise** specifically: it is the weakest of the twelve. Real performance work requires a
profiler and a benchmark, not a language model reading a function. When we ship it, it must be grounded in
an actual benchmark harness — or we should not ship it at all.

### 5.2 Non-goals for v1 (say no now, loudly)

- Autocomplete / inline generation. _(Not our job. Cursor exists.)_
- Agentic multi-file autonomous refactors. _(Unverifiable at our quality bar. Later, if ever.)_
- Team/collab features, SSO, org policy. _(M11.)_
- macOS and Linux builds. _(Architected for; not shipped.)_
- Cloud-synced history. _(Contradicts ADR-004 as a default; revisit as opt-in E2EE for Teams.)_
- Git operations (commit, branch, PR). _(We produce patches. Git is the user's.)_
- A web version. _(The whole product is local execution. There is no web version.)_

---

## 6. Functional requirements

### FR-1 Workspace

- Open a local folder; recent workspaces; `.gitignore`-aware ignore rules; live file watching.
- Handle a 10,000-file repository without UI jank.
- **The app is fully functional offline and signed-out for local analysis.** Only cloud AI requires a
  session. _(This is a trust signal as much as a feature.)_

### FR-2 Analysis (no AI)

- On workspace open: index files, detect languages, detect the workspace's own tooling (`eslint`,
  `tsconfig`, `ruff`, `pytest`, `go.mod`).
- Produce a unified `Finding` list from tree-sitter + the workspace's own linters + type-checkers +
  Semgrep, each with: rule id, source, severity, file, line range, message, evidence.
- Findings must **match what the user's own CI produces**. Divergence is a bug.
- Findings panel: virtualised, grouped, filterable by severity/source/language/file.

### FR-3 Repair

- From a finding, request a fix. Context is built from the symbol graph + the finding's evidence.
- Response is a **unified diff** plus a rationale plus a confidence signal.
- The diff is rendered in a Monaco diff editor with **hunk-level staging**.
- Nothing is written to disk without: an explicit apply action, a checkpoint, and a one-keystroke undo.
- Conflict detection: if the file changed on disk since the patch was generated, we detect it by content
  hash and re-propose. **We never force-apply.**

### FR-4 Verification _(the differentiator)_

- Before the user sees a fix: apply it to a CoW overlay, re-run the analyzers, re-run the type-checker,
  and (if enabled) run the **affected** tests.
- Produce a `VerificationReport`: which checks ran, which passed, whether the target finding was resolved,
  and **whether any new finding was introduced** (→ labelled a _regression_, not a fix).
- **Tiered and honest.** Static checks always. Type-check when a config exists. Tests only when the user
  opts in per workspace. We report exactly what ran — "verified against lint and types; tests not run" —
  and never imply more.

### FR-5 Privacy & AI controls

- Settings surface stating plainly what leaves the machine, per mode.
- **BYOK mode:** user supplies their own provider key (OS keychain). Requests go direct to the provider.
  Our servers see nothing.
- **Secret gate:** no payload leaves the machine without passing a secret scan (gitleaks rules) and a
  denylist (`.env`, `.git/config`, `id_rsa`, `.npmrc`, `.aws/`, `.ssh/`). A blocked send tells the user
  _why_, and does not silently proceed.
- Telemetry is **opt-in**, anonymous, and event-level. Never code, never filenames, never repo identity.

### FR-6 Accounts & billing

- Sign in via system browser (PKCE). Free tier with a monthly token allowance. Pro tier. BYOK as a paid
  feature. Quota enforced server-side; the quota wall offers upgrade _or_ BYOK.

### FR-7 Shell quality

- Command palette (`Ctrl/⌘ K`) driving every action in the app from one registry.
- Full keyboard operability. Light and dark themes. Compact and comfortable density.
- Auto-update with staged rollout and a non-blocking "restart when you like".

---

## 7. Non-functional requirements

| Requirement                   | Target                                        | Why this number                                                           |
| ----------------------------- | --------------------------------------------- | ------------------------------------------------------------------------- |
| Cold start to interactive     | **< 2.0 s**                                   | Below the threshold where an app feels "heavy"; IDE users are unforgiving |
| Open a 10k-file repo          | **< 2.0 s**, no dropped frames                | Real repos are this size; jank here is fatal to credibility               |
| Local analysis, single file   | **< 300 ms**                                  | Must feel instant, or users won't wait for grounding                      |
| Time to first AI token        | **< 1.5 s**                                   | Below this, streaming reads as "thinking"; above it, as "broken"          |
| Verification (static + types) | **< 5 s** typical                             | Slower than this and users skip it, which destroys the thesis             |
| Idle memory                   | **< 400 MB**                                  | Must coexist with the user's actual IDE                                   |
| Installer size                | **< 120 MB**                                  | Electron apps rot to 400 MB by accident; audit every release              |
| Crash-free sessions           | **> 99.5 %**                                  | Gate for promoting a staged rollout                                       |
| Accessibility                 | **WCAG 2.2 AA**, zero critical axe violations | Our users are keyboard users; this is table stakes, not charity           |
| API availability              | **99.9 %**                                    | The app must degrade to local-only, not die, when we're down              |

---

## 8. Success metrics

**North star: fix apply-rate** — the percentage of proposed fixes the user actually applies.
This single number measures whether the product is _right_, not merely whether it is _used_. Everything
else is a leading or lagging indicator of it.

| Metric                                   | Launch target | Why                                                  |
| ---------------------------------------- | ------------- | ---------------------------------------------------- |
| **Fix apply-rate**                       | **> 40 %**    | Below ~25% the model is wasting the user's attention |
| Verification pass-rate on proposed fixes | > 70 %        | Measures the AI+grounding quality directly           |
| Fixes reverted within 10 min of apply    | < 5 %         | Measures whether "verified" actually means verified  |
| D7 retention (activated users)           | > 35 %        | Dev tools live or die on week-two                    |
| Time-to-first-verified-fix (new user)    | < 8 min       | The onboarding must reach the magic moment fast      |
| Free → Pro conversion                    | > 3 %         | Sanity check on the quota wall                       |
| Gross margin per Pro user                | > 65 %        | Guards against the token-cost inversion risk         |

---

## 9. Pricing (design constraint, not a marketing decision)

| Tier     | Price           | Includes                                                          | Rationale                                                                                                                                 |
| -------- | --------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **Free** | $0              | Unlimited **local analysis** (no AI). Limited monthly AI tokens.  | Local analysis is genuinely useful and costs us **nothing**. This is the most generous free tier we can afford and it _is_ the marketing. |
| **Pro**  | ~$20/mo         | Generous token allowance, all capabilities, BYOK, priority models | Anchored to Copilot/Cursor pricing                                                                                                        |
| **BYOK** | included in Pro | Your key, your bill, our servers never see your code              | The pressure valve for both our token costs and their privacy concerns                                                                    |
| **Team** | later           | Seats, shared rules, CI action, SSO                               | Where the ARPU is                                                                                                                         |

**Hard rule: we never ship an "unlimited" AI plan.** A power user on a flat plan can cost more in tokens
than they pay. Metering ships in M4, before the first token is ever spent (ADR-023).

---

## 10. Competitive position

|                          | Cursor / Copilot | ESLint / Semgrep    | Snyk / SonarQube | **Fixora**                |
| ------------------------ | ---------------- | ------------------- | ---------------- | ------------------------- |
| Finds real issues        | ✗ hallucinates   | ✅ deterministic    | ✅ deterministic | ✅ **deterministic**      |
| Explains them            | ✅               | ✗                   | partial          | ✅                        |
| Fixes them               | ✅ unverified    | ✗ (limited autofix) | partial          | ✅ **verified**           |
| **Proves the fix works** | ✗                | n/a                 | ✗                | ✅ **unique**             |
| Code stays local         | ✗                | ✅                  | ✗                | ✅ **(BYOK: absolutely)** |
| In your editor           | ✅               | ✅                  | CI               | ✗ _(our weakness)_        |

**Our real weakness is honest and worth stating:** we are not in the editor. Every context switch is a tax.
We pay for it by being _dramatically_ better at the fix loop than any inline plugin can be — and the answer
to "why isn't this a VS Code extension" is: **eventually it is one**, as a distribution channel that hands
off to the app for deep work (M11).

---

## 11. Risks

| Risk                                                     | Severity             | Mitigation                                                                                             |
| -------------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------ |
| **Trust incident** — Fixora sends a `.env` to a provider | **Extinction-level** | Secret gate in the prompt path (FR-5), local-first default, external security audit before paid launch |
| **Token cost inverts the margin**                        | Critical             | Metering from M4, model routing, prompt caching, BYOK, never "unlimited"                               |
| **Verification proves unreliable** across ecosystems     | Critical             | Tiered verification; report honestly what ran; three languages deep, not ten shallow                   |
| **Provider price change / deprecation**                  | High                 | Two live providers from day one (ADR-012); BYOK; local models on the roadmap                           |
| **We're not in the editor**                              | High                 | Be much better at the fix loop; ship an extension as a channel later                                   |
| **Quality drifts invisibly** as prompts/models change    | High                 | Scored golden corpus gating CI (ADR-028)                                                               |
| **SmartScreen / antivirus blocks the installer**         | Medium               | Azure Trusted Signing procured in **M0**; AV vendor submissions before launch                          |
| **Solo-founder bandwidth** (~35 engineer-weeks to v1)    | Medium               | Ruthless scope discipline; ADR-024 is the first application of it                                      |

---

## 12. Launch criteria (v1.0)

Every one of these is a **blocker**. None are negotiable at the end, which is why they are written now.

- [ ] Fix apply-rate > 40% and verification pass-rate > 70% on the golden corpus, for all 3 languages.
- [ ] **Zero** cases of a patch leaving the workspace broken or partially written. Undo restores
      byte-identical content in 100% of tested cases.
- [ ] The secret gate blocks a file containing a live API key, in an automated test, on every CI run.
- [ ] Clean Windows 11 VM: install → sign in → repair a real bug → auto-update → rollback, with **no scary
      OS dialog** at any step.
- [ ] Crash-free sessions > 99.5% across a 2-week beta.
- [ ] Zero critical axe violations; every screen fully keyboard-operable.
- [ ] All six billing state transitions (subscribe/upgrade/downgrade/cancel/payment-fail/expire) produce
      correct entitlements within seconds.
- [ ] The security page truthfully answers "does my code leave my machine" **in its first paragraph**.
- [ ] Every nav link on the website resolves to real content.
</content>

</invoke>
