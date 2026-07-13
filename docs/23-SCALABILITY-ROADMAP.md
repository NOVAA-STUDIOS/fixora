# Fixora — Scalability Roadmap

Two kinds of scale. Only one of them is a real problem.

---

## 1. Technical scale — mostly a non-problem, by construction

**The heavy work runs on the user's machine.** Analysis, verification, indexing, test execution — all of it
scales linearly with users at **zero marginal cost to us**, because the compute is theirs. This is the
quietest, largest benefit of the local-first decision and it is worth naming explicitly: _10,000 users do not
mean 10,000 analysis workers on our infrastructure. They mean zero._

What actually scales on our side:

| Component | Bottleneck | Answer | When |
|---|---|---|---|
| API | Stateless | Horizontal. Add containers. | Whenever |
| Neon | Rows, not code | Partition `usage_events` monthly. Read replicas for analytics. | ~100k users |
| Quota check | Hot path of every AI request | Already O(1) — an indexed read on `usage_rollups`, never a `SUM()` | Designed in |
| Metering writes | Write volume | Batch, async, off the request path | Designed in |
| Model providers | **Their** rate limits | Multi-provider routing (ADR-012) is already load-balancing | Designed in |
| CDN | Downloads | It's a CDN. | Never |

**The genuine technical risk is not throughput. It is provider rate limits** — and the abstraction we built
for resilience turns out to also be the answer for scale, because two providers means twice the ceiling. That
is not a coincidence so much as what good abstractions do: they pay out in a currency you weren't expecting.

---

## 2. Product scale — the actual roadmap

Ordered by **leverage**, not by excitement. Each one is annotated with what it costs _given the architecture
we chose_, which is the whole point of having chosen it.

### 2.1 Teams — orgs, seats, shared rules, SSO

**Why first.** It is where the ARPU is. Individual developer tools have a hard ceiling; the same product sold
to Dana (PRD Persona 3) is worth 10× per engineer.
**Cost:** moderate. Orgs, seats, and role checks in the API. Shared rules are a config file. **SSO/SAML is
where we likely swap Supabase for WorkOS** — contained, because the IdP sits behind one JWKS verification
module (ADR-009). *That containment was the entire reason for the split-brain we accepted.*
**Watch out for:** shared history. It must be **E2EE with client-held keys**, or it is the cloud-code-storage
decision (ADR-004) walking back in through the side door wearing a Teams hat.

### 2.2 `fixora-cli` + GitHub Action

**Why.** The same grounded analysis and verified repairs, running in CI, commenting on PRs. It is the fastest
path from a tool one developer likes to a purchase a company makes — and it puts Fixora in front of every
engineer on the team without any of them installing anything.
**Cost: weeks, not quarters — *because* `core-analysis`, `core-ai` and `core-patch` are framework-free
TypeScript with no Electron and no React** (ADR-001, Repo §2). This is the moment that boundary rule pays for
itself, and it is worth saying plainly: **the discipline of keeping the core pure in month one is what makes
an entire second product nearly free in year two.**

### 2.3 Local models (Ollama / llama.cpp)

**Why.** The enterprise unlock. *"Your code never leaves the building"* is the sentence that closes deals we
otherwise cannot enter — regulated industries, defence, finance, anyone with a hard no-cloud policy.
**Cost:** a new `AIProvider` implementation, plus honest quality expectations (a 7B local model will not match
a frontier model at repair, and we must **say so in the UI** rather than let a user conclude the product is
bad).
**Trade-off:** worse fixes, absolute privacy. Some customers will take that trade instantly, and they are not
customers we can reach any other way.

### 2.4 Repo-wide intelligence

**Why.** Today we repair one symbol. The next tier is *"this pattern is wrong in 40 places"* and _"this
refactor spans 12 files."_ A persistent, incrementally-updated symbol graph across the whole repo.
**Cost:** high. It is a real indexing engine — incremental, cache-coherent, memory-bounded.
**Trade-off:** the honest one. This is the point where we start competing with Cursor on its home turf, and we
should only do it **after** we have won on the fix loop, not instead of winning on it. It is the most seductive
item on this list and the easiest one to start too early.

### 2.5 VS Code / JetBrains extension

**Why.** Our stated weakness (PRD §10) is that we are not in the editor. The answer is an extension that
surfaces findings inline and **hands off to the app for the deep loop** — diff review, verification, history.
**Cost:** low-to-moderate, again because the core packages are pure.
**Watch out for:** this is a distribution channel, not a replacement. If the extension becomes the product, we
have become an inline autocomplete competitor and we will lose that fight. It must be a *doorway*.

### 2.6 Custom rules

**Why.** Let a team encode its own conventions as rules the LLM must respect. Extremely sticky — a codebase
with Fixora rules checked in has switching costs.
**Cost:** low. Semgrep already does the deterministic half; we add the profile plumbing.

### 2.7 On-prem / self-hosted gateway

**Why.** The enterprise cheque. **Cost:** moderate, and *only* moderate because the gateway is stateless and
stores nothing — there is no data-migration story to build. **This is a dividend of a decision we made in
week one for entirely different reasons.**

### 2.8 Data residency (EU)

**Why.** A hard requirement the first time a European company evaluates us. `users.data_region` exists in the
schema from day one (DB §2) because adding a column to a live billing table later is a migration, and adding
it now is one line.

---

## 3. What we will be tempted by, and should refuse

| Temptation | Why it's wrong |
|---|---|
| **Agentic autonomous multi-file refactors** | Unverifiable at our quality bar. Our entire differentiation is *"we prove it works."* An agent that touches 30 files cannot be verified in 5 seconds, and an unverified agent is just Cursor with worse distribution. **This contradicts the thesis, and it is the single most likely way we lose the plot.** |
| **Autocomplete** | Not our job. We would be a worse Copilot with a smaller model budget. |
| **A web version** | The whole product is local execution. There is no web version. Anyone asking for one has misunderstood what we sell. |
| **Ten more languages** | Ten shallow beats three deep only on a pricing page. It loses every actual user (ADR-025). |
| **Cloud-stored history "for convenience"** | ADR-004. This will be proposed roughly quarterly, always with a good reason, and the answer is always no unless it is E2EE. |
| **Our own model** | A frontier lab's budget, for a differentiator we do not need. Our moat is grounding and verification, not weights. |

---

## 4. The honest long-term risk

**Frontier models keep getting better at exactly the thing we do.** In two years, a model may repair code
well enough that grounding adds less than it does today.

**Why the architecture survives that** — and this is the load-bearing sentence of the whole blueprint:

> **Verification does not get less valuable as models get better. It gets *more* valuable.**
>
> A better model produces more fixes, faster, which means *more* patches a human has to decide whether to
> trust. The bottleneck was never generation. It was, and increasingly will be, **trust**. The tool that can
> *prove* a fix works is more useful in a world of excellent models than in a world of mediocre ones.

Grounding is our moat **today**. Verification is our moat **forever**. If we are ever forced to choose between
investing in one, choose verification — and note that everything in this blueprint has been arranged so that
we never have to choose, because the verification engine is also the eval harness (Testing §3) which is also
the thing that keeps the grounding honest.

That is the bet. It is a good one.
</content>
</invoke>
