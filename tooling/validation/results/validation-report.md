# Fixora — Real Repository Repair Acceptance Report (P1.2)

Generated 2026-07-28T03:11:13.323Z from a REAL execution of the engine over the acceptance corpus.
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
| **Repair success rate** (applied, survived full loop) | 4 / 7 (57.1%) |
| **Repair failure rate** | 3 / 7 (42.9%) |
| **Regression rate** | 1 / 7 (14.3%) |
| Verification pass rate (of those that ran) | 5 / 6 (83.3%) |
| Apply success rate (of those that ran) | 4 / 4 (100.0%) |
| Compile pass rate (of those that ran) | 4 / 4 (100.0%) |
| AI-deferred (need a key) | 0 |
| Manual-only findings | 0 |
| Avg repair→compile time (attempted) | 66933 ms |
| Avg project analyze time | 2460 ms |

## Final outcomes (every finding lands in exactly one)

| Outcome | Count |
| --- | ---: |
| SAFE_AUTO_REPAIR_APPLIED | 2 |
| AI_REPAIR_APPLIED | 2 |
| AI_GENERATE_FAILED | 1 |
| VERIFICATION_FAILED | 1 |
| REGRESSION_DETECTED | 1 |

## Per language

| Language | Projects | Findings | Applied | Manual | AI-deferred | Regressions |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| css | 1 | 0 | n/a | 0 | 0 | 0 |
| html | 1 | 0 | n/a | 0 | 0 | 0 |
| javascript | 1 | 1 | 1 / 1 (100.0%) | 0 | 0 | 0 |
| json | 1 | 1 | 0 / 1 (0.0%) | 0 | 0 | 0 |
| python | 2 | 3 | 3 / 3 (100.0%) | 0 | 0 | 0 |
| react | 1 | 1 | 0 / 1 (0.0%) | 0 | 0 | 0 |
| typescript | 1 | 1 | 0 / 1 (0.0%) | 0 | 0 | 1 |

## Failure taxonomy (exact subsystem responsible)

| Subsystem | Classification | Count |
| --- | --- | ---: |
| `ast-verifier` | Parser issue | 1 |
| `response-parser` | Model output issue | 1 |
| `regression-verifier` | Verifier / regression detection | 1 |

### Every failure (reproducible: file + rule + stage + root cause)

- **json-app-config/config.json** json:json-parse → `VERIFICATION_FAILED` at stage `verify-parse` (subsystem: `ast-verifier`) — the parser gate rejected the patched file (would break the file)
- **react-counter/src/Counter.tsx** eslint:react-hooks/rules-of-hooks → `AI_GENERATE_FAILED` at stage `repair` (subsystem: `response-parser`) — model output did not match the repair schema after a re-ask: empty — The model returned no content at all.
- **typescript-pricing/src/pricing.ts** tsc:TS2322 → `REGRESSION_DETECTED` at stage `regression` (subsystem: `regression-verifier`) — repair introduced new finding(s): tsc:TS2304@src/pricing.ts:19

## Project errors / skips (honest)

_None._

## Not measured here (explicit)

- **AI-generated repairs**: require a provider key; deferred, never faked. Counted separately above.
- **CSS / HTML**: no analyzer, so no findings and nothing to repair — reported as unsupported.
