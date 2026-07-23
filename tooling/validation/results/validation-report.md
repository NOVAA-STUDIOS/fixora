# Fixora — Real Repository Repair Acceptance Report (P1.2)

Generated 2026-07-23T11:33:38.313Z from a REAL execution of the engine over the acceptance corpus.
Provider key present: **yes** — AI-required repairs were GENERATED and run through the same gates as deterministic ones.

## Summary (measured)

| Metric | Value |
| --- | ---: |
| Projects validated | 8 |
| Projects skipped/errored | 0 |
| Total findings | 7 |
| Total repair ATTEMPTS (deterministic + AI executed) | 7 |
| — of which deterministic | 2 |
| — of which AI (executed, needs key) | 5 |
| **Repair success rate** (applied, survived full loop) | 6 / 7 (85.7%) |
| **Repair failure rate** | 1 / 7 (14.3%) |
| **Regression rate** | 0 / 7 (0.0%) |
| Verification pass rate (of those that ran) | 6 / 6 (100.0%) |
| Apply success rate (of those that ran) | 6 / 6 (100.0%) |
| Compile pass rate (of those that ran) | 5 / 5 (100.0%) |
| AI-deferred (need a key) | 0 |
| Manual-only findings | 0 |
| Avg repair→compile time (attempted) | 65305 ms |
| Avg project analyze time | 3001 ms |

## Final outcomes (every finding lands in exactly one)

| Outcome | Count |
| --- | ---: |
| SAFE_AUTO_REPAIR_APPLIED | 2 |
| AI_REPAIR_APPLIED | 4 |
| AI_GENERATE_FAILED | 1 |

## Per language

| Language | Projects | Findings | Applied | Manual | AI-deferred | Regressions |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| css | 1 | 0 | n/a | 0 | 0 | 0 |
| html | 1 | 0 | n/a | 0 | 0 | 0 |
| javascript | 1 | 1 | 1 / 1 (100.0%) | 0 | 0 | 0 |
| json | 1 | 1 | 0 / 1 (0.0%) | 0 | 0 | 0 |
| python | 2 | 3 | 3 / 3 (100.0%) | 0 | 0 | 0 |
| react | 1 | 1 | 1 / 1 (100.0%) | 0 | 0 | 0 |
| typescript | 1 | 1 | 1 / 1 (100.0%) | 0 | 0 | 0 |

## Failure taxonomy (exact subsystem responsible)

| Subsystem | Classification | Count |
| --- | --- | ---: |
| `response-parser` | Model output issue | 1 |

### Every failure (reproducible: file + rule + stage + root cause)

- **json-app-config/config.json** json:json-parse → `AI_GENERATE_FAILED` at stage `repair` (subsystem: `response-parser`) — model output did not match the repair schema after a re-ask: empty — The model returned no content at all.

## Project errors / skips (honest)

_None._

## Not measured here (explicit)

- **AI-generated repairs**: require a provider key; deferred, never faked. Counted separately above.
- **CSS / HTML**: no analyzer, so no findings and nothing to repair — reported as unsupported.
