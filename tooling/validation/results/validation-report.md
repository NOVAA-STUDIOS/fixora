# Fixora — Real Repository Repair Acceptance Report (P1.2)

Generated 2026-07-23T09:10:12.537Z from a REAL execution of the engine over the acceptance corpus.
Provider key present: **no** — AI-required repairs are DEFERRED (not measurable without a key) and never counted as success.

## Summary (measured)

| Metric | Value |
| --- | ---: |
| Projects validated | 8 |
| Projects skipped/errored | 0 |
| Total findings | 7 |
| Total repair ATTEMPTS (deterministic + AI executed) | 2 |
| — of which deterministic | 2 |
| — of which AI (executed, needs key) | 0 |
| **Repair success rate** (applied, survived full loop) | 2 / 2 (100.0%) |
| **Repair failure rate** | 0 / 2 (0.0%) |
| **Regression rate** | 0 / 2 (0.0%) |
| Verification pass rate (of those that ran) | 2 / 2 (100.0%) |
| Apply success rate (of those that ran) | 2 / 2 (100.0%) |
| Compile pass rate (of those that ran) | 2 / 2 (100.0%) |
| AI-deferred (need a key) | 5 |
| Manual-only findings | 0 |
| Avg repair→compile time (attempted) | 370 ms |
| Avg project analyze time | 2299 ms |

## Final outcomes (every finding lands in exactly one)

| Outcome | Count |
| --- | ---: |
| SAFE_AUTO_REPAIR_APPLIED | 2 |
| AI_DEFERRED | 5 |

## Per language

| Language | Projects | Findings | Applied | Manual | AI-deferred | Regressions |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| css | 1 | 0 | n/a | 0 | 0 | 0 |
| html | 1 | 0 | n/a | 0 | 0 | 0 |
| javascript | 1 | 1 | n/a | 0 | 1 | 0 |
| json | 1 | 1 | n/a | 0 | 1 | 0 |
| python | 2 | 3 | 2 / 2 (100.0%) | 0 | 1 | 0 |
| react | 1 | 1 | n/a | 0 | 1 | 0 |
| typescript | 1 | 1 | n/a | 0 | 1 | 0 |

## Failure taxonomy (exact subsystem responsible)

_None — every executed repair (deterministic + AI) survived the full loop._

## Project errors / skips (honest)

_None._

## Not measured here (explicit)

- **AI-generated repairs**: require a provider key; deferred, never faked. Counted separately above.
- **CSS / HTML**: no analyzer, so no findings and nothing to repair — reported as unsupported.
