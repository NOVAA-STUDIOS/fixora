# Fixora — API Architecture

**The API is deliberately small.** It is not where the product lives — the product lives on the user's
machine. The API is an authenticated, metered, stateless gateway plus a billing and release surface.

Resisting the gravity that pulls logic into the server is an ongoing act of discipline. Every feature that
creeps into the API is a feature that stops working offline, costs us money to run, and requires the user's
code to leave their machine. **When in doubt, it goes in the client.**

---

## 1. Principles

1. **Stateless.** No sessions, no server-side conversation store. Conversation context is reconstructed by
   the client from local SQLite on every turn. Horizontal scaling is then a non-event.
2. **Zero code retention.** Prompt payloads exist in RAM and die there. Never a disk write, never a DB row,
   never a log line.
3. **Layered.** `api/` (HTTP) → `services/` (use cases) → `domain/` (rules) → `db/`. The domain imports
   nothing from FastAPI, which is what makes the gateway testable without a network.
4. **Versioned from day one.** `/v1/`. A desktop client from six months ago is still in the wild and still
   paying; **we cannot break it**, and unlike a web app we cannot force it to reload.
5. **The client is untrusted.** It is a JavaScript app on someone's machine. Every limit is enforced here.

---

## 2. Surface

| Method | Path                                       | Purpose                                                                   |
| ------ | ------------------------------------------ | ------------------------------------------------------------------------- |
| `GET`  | `/v1/me`                                   | User, plan, entitlements, feature flags (incl. per-profile kill switches) |
| `POST` | `/v1/ai/stream`                            | **The only AI endpoint.** SSE. Task profile + context in, events out.     |
| `POST` | `/v1/ai/cancel`                            | Explicit cancellation (belt-and-braces alongside request abort)           |
| `GET`  | `/v1/usage`                                | Current-period usage for the quota meter in the UI                        |
| `POST` | `/v1/billing/checkout`                     | Stripe Checkout session                                                   |
| `POST` | `/v1/billing/portal`                       | Stripe customer portal                                                    |
| `POST` | `/v1/billing/webhook`                      | Stripe webhooks — signature-verified, idempotent                          |
| `GET`  | `/v1/releases/{channel}/{platform}/{arch}` | Update manifest with rollout eligibility                                  |
| `POST` | `/v1/telemetry`                            | Batched, anonymous, opt-in events                                         |
| `GET`  | `/healthz` `/readyz`                       | Liveness / readiness                                                      |

**That's the whole API.** If it grows past ~15 endpoints before Teams, something has leaked out of the
client that shouldn't have, and that's a design review, not a sprint.

Note there is **no** `/v1/analyze`. Analysis is local, always. Putting it on the server would require
uploading the repo, which is the one thing we have promised never to do.

---

## 3. The AI streaming contract

```
POST /v1/ai/stream
Authorization: Bearer <jwt>
Idempotency-Key: <uuid>
Content-Type: application/json

{ "taskProfile": "repair",
  "context": { "target": {...}, "evidence": [...], "conventions": {...} },
  "modelTier": "frontier",
  "clientVersion": "1.2.0" }

→ 200 text/event-stream
event: meta       data: {"model":"...","provider":"anthropic","requestId":"..."}
event: text       data: {"delta":"The null check is missing because..."}
event: structured data: {"path":"patch.hunks[0]","value":{...}}
event: usage      data: {"inputTokens":2140,"outputTokens":380,"cachedTokens":1800}
event: done       data: {"finishReason":"stop"}
| event: error    data: {"code":"PROVIDER_UNAVAILABLE","retryable":true}
```

**Gateway sequence, in this order:**

```
verify JWT (JWKS) → load entitlement (single indexed read) → check quota (rollup, O(1))
→ check profile kill switch → build provider request → stream through
→ meter tokens ASYNC → return
```

**Metering must never block the stream.** If the metering write fails, the user still gets their fix and we
reconcile from the event log. Failing a paid request because a stats write timed out is a self-inflicted
outage, and it is a mistake teams make constantly.

**Cancellation:** the client aborts the HTTP request; the gateway propagates the abort to the provider.
Partial usage is still metered — we were charged for those tokens, so we account for them. Being sloppy here
is how the margin quietly disappears.

---

## 4. Error envelope

One shape, everywhere. The client's typed error union (TDD §9) maps onto it 1:1.

```json
{
  "error": {
    "code": "QUOTA_EXCEEDED",
    "message": "You've used your 2,000,000 monthly tokens.",
    "action": { "type": "upgrade_or_byok", "url": "https://..." },
    "requestId": "req_01H..."
  }
}
```

`action` is not decoration. **Every error a human sees must name the next step** — that rule is enforced at
the protocol level so it cannot be forgotten at the UI level.

`requestId` is generated in the _renderer_ and propagated through IPC → main → API → provider, so a user
saying "it broke" gives us one string that traces the whole path.

---

## 5. Contract enforcement — how the two languages stay honest

This is the one real cost of ADR-008 (Python API, TypeScript client), and it gets a real answer:

```
FastAPI + Pydantic v2  →  OpenAPI schema  →  CI codegen  →  TypeScript client + types
```

**The TypeScript client is generated, never hand-written.** CI regenerates it and **fails if the checked-in
client differs** from what the current schema produces. Contract drift becomes a compile error rather than a
production incident.

Plus contract tests (schemathesis against the live schema) so the _implementation_ can't drift from the
_schema_ either. Two gates, because a schema that lies is worse than no schema.

---

## 6. Rate limiting & abuse

| Layer                  | Limit                                | Why                                                                                                                                           |
| ---------------------- | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Edge (per IP)          | Coarse                               | Cheap DoS protection                                                                                                                          |
| Per user (entitlement) | Concurrent requests + monthly tokens | The real business control                                                                                                                     |
| Per user (burst)       | Requests/minute                      | Stops a runaway client loop from burning a month's quota in 90 seconds — a bug we will write at some point, and the user shouldn't pay for it |

All server-side. **The client is not a security boundary**, and any limit that lives only in the client is
decoration.

---

## 7. Observability

- Structured JSON logs (structlog), correlated by `requestId`.
- **Logged:** token counts, latency, model, provider, task profile, status, client version.
- **Never logged:** prompt content, completion content, file paths, findings. Enforced by the serializer
  and asserted by a test (Security §9).
- OpenTelemetry traces across gateway → provider. **p99 time-to-first-token is the metric that matters** —
  average latency hides exactly the tail that makes a product feel broken.
- Sentry for exceptions.

**Business dashboards from day one** (they're free once `usage_events` exists, and they're how we catch a
margin inversion in week two rather than month nine): gross margin per user, cost per task profile, token
spend per plan, the ratio of BYOK to managed requests.
</content>
</invoke>
