# Fixora — Analyzer Accuracy Report

Generated 2026-07-21T14:34:25.053Z from a real execution of the analysis engine.
Every number below is measured. Anything not measured is marked `n/a` with a reason.

## Accuracy Dashboard

| Metric | Value |
| --- | ---: |
| **Overall accuracy** | **100.0%** |
| Precision | 100.0% |
| Recall | 100.0% |
| F1 | 100.0% |
| False-positive rate | 0.0% |
| False-negative rate | 0.0% |
| Attribute error rate | 0.0% |
| True positives | 3 |
| False positives | 0 |
| False negatives | 0 |
| Attribute mismatches | 0 |
| Benchmarks passed | 5 / 5 scored |
| Benchmarks failing (known defects) | 0 |
| Benchmarks skipped | 0 |
| Benchmarks unsupported | 3 |

### Per language

| Name | Accuracy | Precision | Recall | F1 | TP | FP | FN | Cases |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| python | 100.0% | 100.0% | 100.0% | 100.0% | 2 | 0 | 0 | 3 |
| typescript | 100.0% | 100.0% | 100.0% | 100.0% | 1 | 0 | 0 | 2 |

### Per analyzer

| Name | Accuracy | Precision | Recall | F1 | TP | FP | FN | Cases |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| ruff | 100.0% | 100.0% | 100.0% | 100.0% | 2 | 0 | 0 | 2 |
| tsc | 100.0% | 100.0% | 100.0% | 100.0% | 1 | 0 | 0 | 1 |

### Per rule

| Name | Accuracy | Precision | Recall | F1 | TP | FP | FN | Cases |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| B006 | 100.0% | 100.0% | 100.0% | 100.0% | 1 | 0 | 0 | 1 |
| F821 | 100.0% | 100.0% | 100.0% | 100.0% | 1 | 0 | 0 | 1 |
| TS2304 | 100.0% | 100.0% | 100.0% | 100.0% | 1 | 0 | 0 | 1 |

### Unsupported languages

| Language | Cases | Status | Reason |
| --- | ---: | --- | --- |
| css | 1 | **No analyzer available** | languageForPath() in packages/core-analysis/src/language.ts maps only ts/tsx/mts/cts/js/jsx/mjs/cjs/py/pyi/go. It returns null for this extension, so no analyzer is ever selected and the file is never read. ADR-025 accepts this language as Tier B (validation-only) but no validator is implemented. This case exists so the gap is counted, not forgotten — and so that the day a validator lands, its output is measured against a written expectation instead of being trusted. |
| html | 1 | **No analyzer available** | languageForPath() in packages/core-analysis/src/language.ts maps only ts/tsx/mts/cts/js/jsx/mjs/cjs/py/pyi/go. It returns null for this extension, so no analyzer is ever selected and the file is never read. ADR-025 accepts this language as Tier B (validation-only) but no validator is implemented. This case exists so the gap is counted, not forgotten — and so that the day a validator lands, its output is measured against a written expectation instead of being trusted. |
| json | 1 | **No analyzer available** | languageForPath() in packages/core-analysis/src/language.ts maps only ts/tsx/mts/cts/js/jsx/mjs/cjs/py/pyi/go. It returns null for this extension, so no analyzer is ever selected and the file is never read. ADR-025 accepts this language as Tier B (validation-only) but no validator is implemented. This case exists so the gap is counted, not forgotten — and so that the day a validator lands, its output is measured against a written expectation instead of being trusted. |

These are **not** scored. They are excluded from every accuracy figure above, because a
language with no analyzer has no accuracy — reporting 0% would imply a broken analyzer and
100% would be a vacuous pass. They are counted here so the gap stays visible.

### Known defects

_None._

### Failures

_None._

### Repair

| Metric | Value |
| --- | ---: |
| Repair success rate | **Not Measured (Provider Required)** |
| Verification success rate | **Not Measured (Provider Required)** |
| Regression rate | **Not Measured (Provider Required)** |

No provider key found in `FIXORA_BENCH_OPENROUTER_KEY`, so no repair was generated and no repair metric is reported. Repair success, verification success and regression rate all require real model calls — an estimate here would be indistinguishable from a measurement to anyone reading the report, which is why the harness reports nothing instead. Set the variable and re-run to populate these figures; no code changes are needed.

### Toolchain

Accuracy is a property of Fixora **and** the tools it drives, so the exact versions are recorded.

| Tool | Version |
| --- | --- |
| eslint | v9.39.5 |
| ruff | ruff 0.15.22 |
| tsc | Version 6.0.3 |

### Confidence

Measured over **3 expected findings** across **5 scored benchmark cases**. This is a **small sample**. With 3 expected findings, a single miss moves recall by roughly 33.3 points, so the headline percentage should be read as an indication rather than a stable rate. Growing the dataset is the highest-value next step. **3 cases are unsupported** and contribute nothing to the figures above. Fixora currently has no analyzer for those languages. **Repair accuracy is unmeasured.** No provider key was available for this run.
