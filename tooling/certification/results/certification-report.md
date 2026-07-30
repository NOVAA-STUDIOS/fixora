# Fixora — Certification Report

Generated 2026-07-30T16:02:31.647Z from a REAL execution of the engine over samples/certification.
Every number is measured. AI-only repairs are reported as deferred (a provider key is required to
execute them) — never counted as a success. CSS/HTML have no analyzer and are marked unsupported.

## Summary

| Metric | Value |
| --- | ---: |
| Samples passed | 22 / 22 scored |
| Detection precision | 100.0% |
| Detection recall | 100.0% |
| False positives | 0 |
| False negatives | 0 |
| Deterministic repairs succeeded | 2 / 2 (100.0%) |
| AI repairs deferred (provider key required) | 21 |
| Regressions introduced by repair | 0 |
| Average pipeline time / sample | 4151 ms |

## Per language

| Language | Passed | Precision | Recall | FP | FN | Det.repair | AI-deferred | Unsupported |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| css | 1/1 | 100.0% | 100.0% | 0 | 0 | — | 1 | 0 |
| html | 0/0 | n/a | n/a | 0 | 0 | — | 0 | 1 |
| javascript | 5/5 | 100.0% | 100.0% | 0 | 0 | — | 6 | 0 |
| json | 4/4 | 100.0% | 100.0% | 0 | 0 | — | 2 | 0 |
| python | 5/5 | 100.0% | 100.0% | 0 | 0 | 2/2 | 2 | 0 |
| react | 3/3 | 100.0% | 100.0% | 0 | 0 | — | 8 | 0 |
| typescript | 4/4 | 100.0% | 100.0% | 0 | 0 | — | 2 | 0 |

## Failures

_None._

## Not certified here (honest)

- **AI (model) repairs**: executing them needs a provider key; they are counted as *deferred*, not
  as pass or fail. Run the keyed round-trip harness to certify the model leg.
- **CSS / HTML**: no analyzer exists, so these samples are unsupported and scored nowhere.
