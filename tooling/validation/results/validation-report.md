# Fixora — Real Repository Validation Report (P1.1)

Generated 2026-07-23T08:37:31.369Z from a REAL execution of the engine over the validation corpus.
Provider key present: **no** — AI-required repairs are DEFERRED (not measurable without a key) and never counted as success.

## Summary (measured)

| Metric | Value |
| --- | ---: |
| Projects validated | 8 |
| Projects skipped/errored | 0 |
| Total findings | 7 |
| Deterministic repair attempts | 2 |
| Deterministic repairs applied (survived full loop) | 2 / 2 (100.0%) |
| Verification pass rate (of those that ran) | 2 / 2 (100.0%) |
| Apply success rate (of those that ran) | 2 / 2 (100.0%) |
| Compile pass rate (of those that ran) | 2 / 2 (100.0%) |
| Regressions rejected by the harness | 0 |
| Manual-only findings | 0 |
| AI-deferred findings (need a key) | 5 |
| Unsupported-language findings | 0 |
| Avg deterministic repair→compile time | 502 ms |
| Avg project analyze time | 3143 ms |

## Final outcomes (every finding lands in exactly one)

| Outcome | Count |
| --- | ---: |
| SAFE_AUTO_REPAIR_APPLIED | 2 |
| AI_DEFERRED | 5 |

## Per language

| Language | Projects | Findings | Det.applied | Manual | AI-deferred | Regressions |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| css | 1 | 0 | n/a | 0 | 0 | 0 |
| html | 1 | 0 | n/a | 0 | 0 | 0 |
| javascript | 1 | 1 | n/a | 0 | 1 | 0 |
| json | 1 | 1 | n/a | 0 | 1 | 0 |
| python | 2 | 3 | 2 / 2 (100.0%) | 0 | 1 | 0 |
| react | 1 | 1 | n/a | 0 | 1 | 0 |
| typescript | 1 | 1 | n/a | 0 | 1 | 0 |

## Deterministic repair failures (exact subsystem + reason)

_None — every executed deterministic repair survived the full loop._

## Project errors / skips (honest)

_None._

## Not measured here (explicit)

- **AI-generated repairs**: require a provider key; deferred, never faked. Counted separately above.
- **CSS / HTML**: no analyzer, so no findings and nothing to repair — reported as unsupported.
