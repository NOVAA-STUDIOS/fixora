# Fixora — Real Repository Repair Acceptance Report (P1.2)

Generated 2026-08-14T16:18:14.700Z from a REAL execution of the engine over the acceptance corpus.
Provider key present: **yes** — AI-required repairs were GENERATED and run through the same gates as deterministic ones.

## Summary (measured)

| Metric | Value |
| --- | ---: |
| Projects validated | 8 |
| Projects skipped/errored | 0 |
| Total findings | 6 |
| Total repair ATTEMPTS (deterministic + AI executed) | 6 |
| — of which deterministic | 2 |
| — of which AI (executed, needs key) | 4 |
| **Repair success rate** (applied, survived full loop) | 4 / 6 (66.7%) |
| **Repair failure rate** | 2 / 6 (33.3%) |
| **Regression rate** | 0 / 6 (0.0%) |
| Verification pass rate (of those that ran) | 5 / 5 (100.0%) |
| Apply success rate (of those that ran) | 4 / 4 (100.0%) |
| Compile pass rate (of those that ran) | 1 / 1 (100.0%) |
| AI-deferred (need a key) | 0 |
| Manual-only findings | 0 |
| Avg repair→compile time (attempted) | 90080 ms |
| Avg project analyze time | 8474 ms |

## Final outcomes (every finding lands in exactly one)

| Outcome | Count |
| --- | ---: |
| SAFE_AUTO_REPAIR_APPLIED | 2 |
| AI_REPAIR_APPLIED | 2 |
| AI_GENERATE_FAILED | 2 |

## Retry effectiveness

| Attempts needed | Findings |
| --- | ---: |
| 1 | 2 |
| 2 | 1 |

| Metric | Value |
| --- | ---: |
| Records with per-attempt data | 3 / 6 (50.0%) |
| Verified on attempt 1 | 2 / 3 (66.7%) |
| Rescued by a retry (failed first, verified later) | 0 / 3 (0.0%) |

## Per language

| Language | Projects | Findings | Applied | Manual | AI-deferred | Regressions |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| css | 1 | 0 | n/a | 0 | 0 | 0 |
| html | 1 | 0 | n/a | 0 | 0 | 0 |
| javascript | 1 | 0 | n/a | 0 | 0 | 0 |
| json | 1 | 1 | 1 / 1 (100.0%) | 0 | 0 | 0 |
| python | 2 | 3 | 3 / 3 (100.0%) | 0 | 0 | 0 |
| react | 1 | 1 | 0 / 1 (0.0%) | 0 | 0 | 0 |
| typescript | 1 | 1 | 0 / 1 (0.0%) | 0 | 0 | 0 |

## Failure taxonomy (exact subsystem responsible)

| Subsystem | Classification | Count |
| --- | --- | ---: |
| `response-parser` | Model output issue | 1 |
| `ai-provider` | Provider limitation | 1 |

### Every failure (reproducible: file + rule + stage + root cause)

- **react-counter/src/Counter.tsx** eslint:react-hooks/rules-of-hooks → `AI_GENERATE_FAILED` at stage `repair` (subsystem: `response-parser`) — model output did not match the repair schema after a re-ask: empty — The model returned no content at all.
- **typescript-pricing/src/pricing.ts** tsc:TS2322 → `AI_GENERATE_FAILED` at stage `repair` (subsystem: `ai-provider`) — retry 3 failed to generate: 429 Too Many Requests — Provider returned error (HTTP_429)

## Project errors / skips (honest)

_None._

## Not measured here (explicit)

- **AI-generated repairs**: require a provider key; deferred, never faked. Counted separately above.
- **CSS / HTML**: no analyzer, so no findings and nothing to repair — reported as unsupported.
