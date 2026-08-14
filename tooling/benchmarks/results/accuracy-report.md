# Fixora — Analyzer Accuracy Report

Generated 2026-08-13T16:09:18.529Z from a real execution of the analysis engine.
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
| True positives | 20 |
| False positives | 0 |
| False negatives | 0 |
| Attribute mismatches | 0 |
| Benchmarks passed | 26 / 26 scored |
| Benchmarks failing (known defects) | 0 |
| Benchmarks skipped | 3 |
| Benchmarks unsupported | 2 |

### Per language

| Name | Accuracy | Precision | Recall | F1 | TP | FP | FN | Cases |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| javascript | 100.0% | 100.0% | 100.0% | 100.0% | 5 | 0 | 0 | 6 |
| json | 100.0% | 100.0% | 100.0% | 100.0% | 3 | 0 | 0 | 4 |
| python | 100.0% | 100.0% | 100.0% | 100.0% | 6 | 0 | 0 | 7 |
| react | 100.0% | 100.0% | 100.0% | 100.0% | 2 | 0 | 0 | 3 |
| typescript | 100.0% | 100.0% | 100.0% | 100.0% | 4 | 0 | 0 | 6 |

### Per analyzer

| Name | Accuracy | Precision | Recall | F1 | TP | FP | FN | Cases |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| eslint | 100.0% | 100.0% | 100.0% | 100.0% | 7 | 0 | 0 | 7 |
| json | 100.0% | 100.0% | 100.0% | 100.0% | 3 | 0 | 0 | 3 |
| ruff | 100.0% | 100.0% | 100.0% | 100.0% | 6 | 0 | 0 | 6 |
| tsc | 100.0% | 100.0% | 100.0% | 100.0% | 4 | 0 | 0 | 4 |

### Per rule

| Name | Accuracy | Precision | Recall | F1 | TP | FP | FN | Cases |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| B006 | 100.0% | 100.0% | 100.0% | 100.0% | 1 | 0 | 0 | 1 |
| F401 | 100.0% | 100.0% | 100.0% | 100.0% | 1 | 0 | 0 | 1 |
| F541 | 100.0% | 100.0% | 100.0% | 100.0% | 1 | 0 | 0 | 1 |
| F811 | 100.0% | 100.0% | 100.0% | 100.0% | 1 | 0 | 0 | 1 |
| F821 | 100.0% | 100.0% | 100.0% | 100.0% | 1 | 0 | 0 | 1 |
| F841 | 100.0% | 100.0% | 100.0% | 100.0% | 1 | 0 | 0 | 1 |
| json-parse | 100.0% | 100.0% | 100.0% | 100.0% | 3 | 0 | 0 | 3 |
| no-constant-condition | 100.0% | 100.0% | 100.0% | 100.0% | 1 | 0 | 0 | 1 |
| no-dupe-keys | 100.0% | 100.0% | 100.0% | 100.0% | 1 | 0 | 0 | 1 |
| no-self-compare | 100.0% | 100.0% | 100.0% | 100.0% | 1 | 0 | 0 | 1 |
| no-unreachable | 100.0% | 100.0% | 100.0% | 100.0% | 1 | 0 | 0 | 1 |
| react-hooks/exhaustive-deps | 100.0% | 100.0% | 100.0% | 100.0% | 1 | 0 | 0 | 1 |
| react-hooks/rules-of-hooks | 100.0% | 100.0% | 100.0% | 100.0% | 1 | 0 | 0 | 1 |
| TS2304 | 100.0% | 100.0% | 100.0% | 100.0% | 1 | 0 | 0 | 1 |
| TS2322 | 100.0% | 100.0% | 100.0% | 100.0% | 2 | 0 | 0 | 2 |
| TS2345 | 100.0% | 100.0% | 100.0% | 100.0% | 1 | 0 | 0 | 1 |
| use-isnan | 100.0% | 100.0% | 100.0% | 100.0% | 1 | 0 | 0 | 1 |

### Performance

| Metric | Value |
| --- | ---: |
| Average analysis time / case | 5726.3 ms |
| Average analysis time / file | 4652.6 ms |
| Total analysis time | 148.88 s |
| Scored cases run | 26 (32 files) |

_Wall-clock on this machine, this run. Small cases, so per-case time is dominated by process_
_startup (spawning eslint/tsc/ruff), not analysis of the file — read it as an order of magnitude._

### Unsupported languages

| Language | Cases | Status | Reason |
| --- | ---: | --- | --- |
| css | 1 | **No analyzer available** | languageForPath() in packages/core-analysis/src/language.ts maps only ts/tsx/mts/cts/js/jsx/mjs/cjs/py/pyi/go. It returns null for this extension, so no analyzer is ever selected and the file is never read. ADR-025 accepts this language as Tier B (validation-only) but no validator is implemented. This case exists so the gap is counted, not forgotten — and so that the day a validator lands, its output is measured against a written expectation instead of being trusted. |
| html | 1 | **No analyzer available** | languageForPath() in packages/core-analysis/src/language.ts maps only ts/tsx/mts/cts/js/jsx/mjs/cjs/py/pyi/go. It returns null for this extension, so no analyzer is ever selected and the file is never read. ADR-025 accepts this language as Tier B (validation-only) but no validator is implemented. This case exists so the gap is counted, not forgotten — and so that the day a validator lands, its output is measured against a written expectation instead of being trusted. |

These are **not** scored. They are excluded from every accuracy figure above, because a
language with no analyzer has no accuracy — reporting 0% would imply a broken analyzer and
100% would be a vacuous pass. They are counted here so the gap stays visible.

### Skipped (tool unavailable on this machine)

- `go-vet-printf` — Requires go — not available on this machine.
- `mypy-arg-type` — Requires mypy — not available on this machine.
- `semgrep-eval` — Requires semgrep — not available on this machine.

A skipped case is a fact about the runner, not about Fixora. Not scored.

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
| ruff | ruff 0.15.22 |
| tsc | Version 6.0.3 |

### Confidence

Measured over **20 expected findings** across **26 scored benchmark cases**. This is a **small sample**. With 20 expected findings, a single miss moves recall by roughly 5.0 points, so the headline percentage should be read as an indication rather than a stable rate. Growing the dataset is the highest-value next step. **2 cases are unsupported** and contribute nothing to the figures above. Fixora currently has no analyzer for those languages. **3 cases were skipped** because their tool is not installed here; the same suite on a machine with those tools will measure more. **Repair accuracy is unmeasured.** No provider key was available for this run.
