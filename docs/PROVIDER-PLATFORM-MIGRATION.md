# Universal AI Provider Platform — Migration Plan

**Status: PROPOSED — awaiting approval. No implementation has started.**
**Baseline:** `main` @ `ed4e4d9`

---

## 0. Executive summary

The good news first: **the Repair Engine boundary is already clean.** `ai-service.ts` receives text
from a provider, hands it to `parseRepairOutput`, and passes the result to `verification.verify()`.
Nothing downstream of that point — not the parser, the verifier, the regression check, or the Apply
gate — can observe which provider produced the text. The requirement "the Repair Engine must never
know which provider generated the response" is **satisfied today**. This sprint's job is to avoid
breaking it, not to create it.

The failover loop shipped last sprint (`runWithFailover`) is likewise already provider-agnostic: a
candidate is `{provider, model}` and the loop never inspects either.

What is *not* ready is everything that decides **which provider, with which key, and what it can do**.
That layer is OpenRouter-shaped from top to bottom, and it is where all eleven conflicts live.

---

## 1. Architectural conflicts

Ordered by how much they constrain the design. **C1–C5 are structural** and cannot be worked around
incrementally; C6–C11 are contained.

### C1 — Identity is singular, everywhere · STRUCTURAL

`StoredCredentials` is `{ keyEnc, hint, model }` — one key, one model, one file
(`ai-credentials.json`). `AiConfig` on the IPC contract is equally singular, and so is every channel:
`ai:setKey`, `ai:setModel`, `ai:clearKey`, `ai:getConfig`, `ai:listModels`.

A provider registry is not an additive change to this shape; it replaces it. Every one of those
channels needs a provider-scoped counterpart, and the renderer's settings panel consumes the singular
`AiConfig` directly.

**Consequence:** the IPC contract and the settings surface must both change. Backward compatibility
becomes a migration problem, not a compatibility shim (see §4).

### C2 — Capability data is OpenRouter catalogue metadata · STRUCTURAL

`capabilitiesFor(model: CatalogueModel)` derives every capability decision from OpenRouter's
`/api/v1/models` response — `supported_parameters`, `pricing`, `context_length`. This is genuinely
good design *for one provider*: capabilities are read, never assumed.

It does not generalise. Anthropic, OpenAI and Google publish no equivalent endpoint with that shape,
and Ollama's `/api/tags` returns names and sizes with **no capability flags at all**. There is no
per-model capability metadata to read for four of the five required providers.

**Consequence:** the capability matrix must invert — from *fetched per-model metadata* to
*provider-declared capabilities, with optional per-model overrides*. `buildFailoverChain` and
`ai:getConfig` both depend on `CatalogueModel` and both must be re-pointed.

This is the single most invasive conflict, because the current design's virtue — never assume a
capability — becomes impossible to honour literally. The honest replacement is: **declare
capabilities per provider from documented behaviour, keep reading them per-model where a provider
publishes them (OpenRouter), and record the basis either way** so the UI can still say *why* it
believes something.

### C3 — Structured output assumes one wire format · STRUCTURAL

`ResponseSchema` is translated in `buildBody` to OpenAI's `response_format: { type: 'json_schema' }`.
That is one vendor's mechanism:

| Provider | How JSON is forced |
|---|---|
| OpenRouter / OpenAI | `response_format: json_schema` |
| Anthropic | **tool-use** — declare a tool, set `tool_choice`, read `input` |
| Google AI Studio | `responseMimeType: application/json` + `responseSchema` |
| Ollama | `format: json` (schema support varies by version, often absent) |

The `ProviderRequest.responseSchema` *interface* is fine. The conflict is that the translation
currently lives in a place that assumes everyone speaks OpenAI. Each adapter must own its own
translation, and a provider that cannot honour a schema at all must say so through the capability
matrix rather than silently returning prose — because `parseRepairOutput` would then fail, and repair
writes to source files.

### C4 — Failure classification is HTTP-status-centric · STRUCTURAL

`describeProviderFailure` keys on `/^HTTP_(\d{3})$/`. Correct for cloud APIs. Wrong for local:

- **Ollama not running** surfaces as `NETWORK` → *"Check your internet connection or VPN"*. The
  daemon is on localhost. The correct guidance is "start Ollama".
- **Ollama 404** means *the model is not pulled*, not *the model was retired*. The remedy is
  `ollama pull <model>`, not "pick another model in Settings".

**Consequence:** classification needs a provider-supplied hint layer. The eleven categories and the
layer/action model stay; adapters gain the ability to map their own error shapes onto them and to
override the remedy text. Note this directly affects the error card shipped two sprints ago.

### C5 — The failover chain cannot span providers · STRUCTURAL

`buildFailoverChain` returns candidates that all share one `provider` string, and — more importantly —
`ai-service.ts` resolves the key and constructs the adapter **once, outside the walk**:

```ts
const provider = makeProvider(key);          // one adapter, one key
const walk = await runWithFailover(chain, async (candidate) =>
  streamOnce(provider, { ...request, model: candidate.model }, …));
```

Cross-provider failover requires each candidate to carry its own adapter *and* its own credential.
The loop is fine; the construction site is the conflict.

### C6 — Two consumers build providers independently

`ai-service.ts` and `proceed.handlers.ts` both call `createOpenRouterProvider` directly. Proceed has
**no failover at all** today. Leaving this unaddressed guarantees drift and duplicates
provider-selection logic — exactly what the sprint's quality rules forbid. Both must route through the
orchestrator.

### C7 — Secret storage is a single blob

One `keyEnc` field. Multi-provider needs N secrets. `safeStorage` (DPAPI / Keychain / Secret Service)
is **already the right primitive** and already fails safely — `setKey` throws a `UserFacingError`
rather than writing plaintext when the keychain is unavailable. That requirement is met; the storage
*schema* is what changes.

### C8 — `ai:listModels` is OpenRouter-only

The renderer's model picker consumes a single flat `AiModelList`. Per-provider discovery differs in
kind: OpenRouter/OpenAI expose a catalogue endpoint, Anthropic effectively has a static list, Ollama's
list is local, dynamic, and reflects what the user has pulled.

### C9 — Free-tier economics are baked in

`PREFERRED_FREE_CODE_MODELS`, `pickDefaultModel` (prefers free), `NO_FREE_MODELS_MESSAGE`. Anthropic
and OpenAI have no free tier; Ollama is always free. Default-model selection must become per-provider.

### C10 — Health tracking overlaps existing telemetry

There is already a `metrics-store` ring buffer with a `.strict()` privacy schema recording provider,
model, latency, outcome and validation results. Building a second, parallel telemetry subsystem for
provider health would be immediate technical debt. **Health should be derived from — or recorded
into — the existing store.**

### C11 — `AIProvider` has no non-streaming call path

Test Connection needs one. `AIProvider` exposes only `stream()`. Adding `test()` to the interface is
correct and intended, but it *is* an interface change every adapter must satisfy.

---

## 2. Target architecture

### Layering

```
┌──────────────────────────────────────────────────────────────┐
│ Renderer — Settings ▸ AI Providers page, model pickers        │
└───────────────▲──────────────────────────────────────────────┘
                │ IPC (provider-scoped, additive channels)
┌───────────────┴──────────────────────────────────────────────┐
│ MAIN                                                          │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ AI Orchestrator                                         │  │
│  │  • resolves the candidate chain from user PRIORITY      │  │
│  │  • filters by CAPABILITY for the requested profile      │  │
│  │  • runs the existing failover walk                      │  │
│  │  • records health + metrics                             │  │
│  └───────▲─────────────────────────────┬──────────────────┘  │
│          │ credentials                  │ AIProvider          │
│  ┌───────┴────────┐          ┌──────────▼───────────────────┐ │
│  │ CredentialStore│          │ ProviderFactory              │ │
│  │ (safeStorage)  │          │ descriptor + secret → adapter│ │
│  └────────────────┘          └──────────┬───────────────────┘ │
└───────────────────────────────────────── │ ────────────────────┘
                                           ▼
      ┌────────────────────────────────────────────────────────┐
      │ Adapters — all implement AIProvider                     │
      │  openai-compatible (base) ─┬─ openrouter                │
      │                            ├─ openai                    │
      │                            └─ (azure, groq, together…)  │
      │  anthropic · google · ollama                            │
      └────────────────────────────────────────────────────────┘
```

**The line that must not move:** the orchestrator returns *text*. Everything below — `parseRepairOutput`,
`verification.verify()`, `computeVerdict`, `spliceLines`, `evaluateApplyGate` — is untouched and
provider-blind. That is the existing boundary, and preserving it is the sprint's primary constraint.

### Folder structure

```
packages/core-ai/src/provider/
  types.ts                 AIProvider (+ test()), ProviderRequest, ProviderEvent
  descriptor.ts        NEW  ProviderDescriptor: id, label, auth kind, endpoints, defaults
  capability.ts        NEW  declared capability matrix + per-model overrides
  failure.ts                classification (+ adapter-supplied hints)
  failover.ts               the walk — UNCHANGED
  chain.ts             NEW  priority + capability → candidates (replaces buildFailoverChain)
  models/
    discovery.ts       NEW  per-provider model discovery strategies
    catalogue.ts             OpenRouter catalogue (becomes one strategy)
  adapters/
    openai-compatible.ts NEW shared chat-completions wire format
    openrouter.ts             refactored onto the base
    openai.ts          NEW
    anthropic.ts       NEW    messages API; tool-use for structured output
    google.ts          NEW    generateContent + responseSchema
    ollama.ts          NEW    /api/chat NDJSON; /api/tags discovery

apps/desktop/electron/main/ai/
  credentials/credential-store.ts  NEW  multi-provider secrets + migration
  providers/provider-registry.ts   NEW  enabled · priority · defaultModel
  providers/provider-factory.ts    NEW  descriptor + secret → AIProvider
  providers/health-store.ts        NEW  rolling health, fed by existing metrics
  providers/connection-test.ts     NEW  Test Connection
  orchestrator.ts                  NEW  the single entry point for AI calls
  ai-service.ts                          routed through the orchestrator
```

### Data flow

```
Repair Request (findingId, profile, mode)
   │
   ├─ context assembly + secret gate            [unchanged]
   ▼
AI Orchestrator
   ├─ chain = registry.priority()
   │          .filter(enabled)
   │          .filter(capability.supports(profile))
   │          .map(→ {providerId, model})
   ├─ runWithFailover(chain, attempt)           [unchanged loop]
   │     └─ attempt = factory.create(providerId, secret).stream(req)
   └─ on each failure: health.record(), metrics.record()
   ▼
raw text  ◄── the Repair Engine boundary; nothing below knows the provider
   ▼
parseRepairOutput → verification.verify() → computeVerdict → proposal → Apply gate
                                    [ALL UNCHANGED]
```

---

## 3. Capability matrix

Declared per provider, overridable per model, with a recorded basis:

| Capability | OpenRouter | OpenAI | Anthropic | Google | Ollama |
|---|---|---|---|---|---|
| Streaming | ✓ | ✓ | ✓ | ✓ | ✓ |
| JSON / schema | per-model | ✓ | via tool-use | ✓ | partial |
| Function calling | per-model | ✓ | ✓ | ✓ | per-model |
| Reasoning | per-model | per-model | per-model | per-model | per-model |
| Images | per-model | per-model | ✓ | ✓ | per-model |
| Large context | per-model | per-model | ✓ | ✓ | per-model |
| **Code repair** | derived | derived | derived | derived | derived |

**Code repair is derived, never declared**: it is `streaming && jsonMode && context ≥ budget`. Deriving
it keeps one rule in one place instead of five hand-maintained booleans that will disagree.

---

## 4. Backward compatibility

The contract: **an existing OpenRouter user changes nothing and notices nothing.**

1. On first launch, if `ai-credentials.json` exists and no registry does, migrate it: create a
   registry with OpenRouter `enabled: true, priority: 1, defaultModel: <stored model>`, and move the
   ciphertext into the new credential store under `openrouter`.
2. The migration is **read-only against the old file** — it is not deleted, so a downgrade still
   works. This costs one stale file and buys a safe rollback.
3. Old IPC channels (`ai:getConfig`, `ai:setKey`, `ai:setModel`, `ai:listModels`) are **kept and
   reimplemented** against the registry, operating on the highest-priority enabled provider. They are
   not removed in this sprint.
4. A migration test asserts: given a v1 credentials file, the user gets a working OpenRouter setup
   with the same model, and `ai:getConfig` returns the same shape it did before.

---

## 5. Implementation plan — milestones

Each is a separate commit, each independently green, each with no behaviour change unless stated.

| # | Milestone | Behaviour change | Key risk |
|---|---|---|---|
| **M1** | Capability matrix + `AIProvider.test()`; OpenRouter declares itself | none | re-pointing `capabilitiesFor` |
| **M2** | Extract `openai-compatible` base; OpenRouter refactored onto it | none — proven by existing adapter tests | wire-format drift |
| **M3** | Multi-provider `CredentialStore` + migration from `ai-credentials.json` | none | silent key loss — heavily tested |
| **M4** | `ProviderRegistry` (enabled/priority/defaultModel) + additive IPC | none | contract churn |
| **M5** | Orchestrator; `ai-service` **and** Proceed routed through it (fixes C6) | Proceed gains failover | regression surface is largest here |
| **M6a–d** | Adapters: OpenAI · Anthropic · Google · Ollama (one commit each) | new providers selectable | per-vendor JSON strategy (C3) |
| **M7** | Test Connection + health, fed by the existing metrics store (C10) | new | none |
| **M8** | Settings ▸ AI Providers page + priority ordering | new page | UI scope (see Q1/Q2) |
| **M9** | Privacy copy, docs, full regression sweep | none | — |

**M5 is the regression-critical commit.** Everything before it is inert scaffolding; M5 is where the
live repair path changes hands. It gets the full suite plus a manual validation pass before M6 starts.

### Testing per milestone

Provider selection · priority ordering · failover across providers · invalid key · timeout ·
authentication · local (Ollama) · cloud · capability-based selection · secure key storage ·
**backward compatibility** · and a standing assertion that `core-analysis`, `verification/` and
`apply-diagnostics.ts` show zero diff across the entire sprint.

---

## 6. Open questions — blocking

These change the work materially and I will not assume answers.

**Q1 · Settings page: replace or add?**
"Do not change existing UI behavior" and "create a professional AI Providers page" pull opposite ways.
Additive (new page, existing AI settings untouched) is safest but leaves two places to configure a
model. Replacement is cleaner but *is* a change to existing UI behaviour.

**Q2 · Drag-and-drop ordering needs a dependency.**
There is no DnD library in the repo, and this codebase has treated "no new dependencies" as a value.
Options: add `@dnd-kit/*`, hand-roll HTML5 drag events, or ship up/down buttons (accessible, keyboard-
navigable, zero deps) and add DnD later.

**Q3 · Sprint size.**
Five adapters + registry + credentials + orchestrator + health + test-connection + a settings page is
roughly 3–4× any sprint so far, and M5 carries the whole regression risk. Ship it as one sprint, or
land M1–M5 + OpenRouter + **one** native adapter (proving the seam) and add M6b–d after a validation
pass?

---

## 7. What this sprint will *not* do

- Touch the Analyzer, Repair Engine, verification pipeline, parser, or Apply gate. Enforced by a
  zero-diff check on those paths in every commit.
- Change repair classification or validation rules.
- Change what `runWithFailover` considers retryable. Availability failures only; parser, verifier,
  regression and safety rejections never trigger a retry — already tested from both directions.
