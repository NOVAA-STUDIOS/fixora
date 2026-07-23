# Fixora — Proceed Mode Editing Acceptance Report (P2.2)

Generated 2026-07-23T14:51:54.929Z from a REAL end-to-end run of the editing pipeline.
Provider key present: **yes** — model `openai/gpt-oss-20b:free`.
Each edit runs intent → scope → context+gate → AI → parse → the SAME verification gates as repair
(parse → formatter → re-analyze/regression → apply → compile), in edit mode (no target finding).

## Summary (measured)

| Metric | Value |
| --- | ---: |
| Edit cases | 7 |
| Supported-language cases | 5 |
| Executed (generated) | 5 |
| **Edits applied (survived full verification)** | 0 / 5 (0.0%) |
| Regressions rejected | 1 |
| Verification failures | 0 |
| Generate failures | 4 |
| Unsupported (css/html, no analyzer) | 2 |
| AI-deferred (no key) | 0 |
| Avg latency (executed) | 15615 ms |

## Per case (request → intent → scope → verify → apply → compile → outcome)

| Language | File | Intent | Scope | Verify | Applied | Compile | Latency | Outcome |
| --- | --- | --- | --- | --- | :-: | :-: | ---: | --- |
| javascript | cache.js | documentation | enclosing-symbol (9L) | verified | — | — | 36018 ms | `REGRESSION_DETECTED` |
| typescript | src/pricing.ts | documentation | enclosing-symbol (3L) | — | — | — | 11134 ms | `AI_GENERATE_FAILED` |
| typescript | src/Counter.tsx | styling | enclosing-symbol (15L) | — | — | — | 18022 ms | `AI_GENERATE_FAILED` |
| python | metrics.py | python | enclosing-symbol (3L) | — | — | — | 12839 ms | `AI_GENERATE_FAILED` |
| json | config.json | refactoring | selection-fallback (1L) | — | — | — | 62 ms | `AI_GENERATE_FAILED` |
| unsupported | theme.css | styling | — | — | — | — | 1 ms | `UNSUPPORTED_LANGUAGE` |
| unsupported | index.html | unknown | — | — | — | — | 0 ms | `UNSUPPORTED_LANGUAGE` |

## Failures (exact reason, reproducible)

- **javascript-http-cache/cache.js** `REGRESSION_DETECTED` — repair introduced new finding(s): tsc:TS2845@cache.js:34
- **typescript-pricing/src/pricing.ts** `AI_GENERATE_FAILED` — 429 Too Many Requests — Rate limit exceeded: free-models-per-day. Add 10 credits to unlock 1000 free model requests per day (HTTP_429)
- **react-counter/src/Counter.tsx** `AI_GENERATE_FAILED` — 429 Too Many Requests — Rate limit exceeded: free-models-per-day. Add 10 credits to unlock 1000 free model requests per day (HTTP_429)
- **python-text-metrics/metrics.py** `AI_GENERATE_FAILED` — 429 Too Many Requests — Rate limit exceeded: free-models-per-day. Add 10 credits to unlock 1000 free model requests per day (HTTP_429)
- **json-app-config/config.json** `AI_GENERATE_FAILED` — 429 Too Many Requests — Rate limit exceeded: free-models-per-day. Add 10 credits to unlock 1000 free model requests per day (HTTP_429)

## Not measured here (explicit)

- **CSS / HTML**: no analyzer or grammar in the engine — the edit cannot be AST-verified, so it is
  reported unsupported (never applied blindly). A CSS/HTML analyzer is future work.
- **AI edits** require a provider key; without one they are DEFERRED, never faked.
