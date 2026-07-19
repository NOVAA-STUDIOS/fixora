# Python benchmark audit — what Ruff can and cannot prove

Done before implementing Ruff, per the rule that we only benchmark a tool against defects it was
designed to detect. The headline result changes the plan.

## The existing Python sample is not a Ruff case

`samples/broken-python/stats.py`:

```python
def mean(values):
    total = 0
    for i in range(len(values) + 1):   # off-by-one → IndexError
        total += values[i]
    return total / len(values)
```

**Classification: Tier 3 (AI reasoning).** No Ruff rule detects this, and none should be expected to.
Ruff is a linter built on pyflakes/pycodestyle/bugbear rules — it reasons about names, imports,
syntax and known-bad constructs. `range(len(values) + 1)` is *syntactically valid, semantically
wrong*: proving it requires understanding that the loop bound must match the sequence length, which is
program semantics, not a lint rule.

This is the same conclusion reached for `samples/broken-js` — an off-by-one in an untyped language is
not reachable by static analysis. TypeScript catches its version only because
`noUncheckedIndexedAccess` turns indexing into a type error, and Python has no equivalent.

**Consequence: had Ruff been implemented against the existing benchmark, it would have shipped with
zero passing Python cases** — and the failure would have looked like a broken integration rather than
a misclassified benchmark. That is precisely what this audit exists to prevent.

## Classification of every Python sample

| Sample | Defect | Detectable by | Rule |
|---|---|---|---|
| `broken-python/stats.py` | off-by-one loop bound → IndexError | **Tier 3** | none |
| `python-ruff/undefined_name.py` | typo'd identifier `totl` | **Ruff** | F821 ✅ verified |
| `python-ruff/mutable_default.py` | mutable default argument | **Ruff** | B006 ✅ verified |

There is no "Compiler" row: Python has no compiler tier in Fixora. `mypy` exists as a tier-1 analyzer
for workspaces that have it, but it is not bundled, so an unconfigured Python folder has Ruff and
nothing else. Worth stating explicitly, because it means Python's deterministic ceiling is lower than
TypeScript's — TS gets both a linter and a type checker; Python gets a linter.

## Rule selection for the bundled tier

The same discipline as the bundled ESLint config: **every rule must flag a defect, not a preference.**

- **Include `F` (pyflakes).** Undefined names, unused imports, unused variables, f-strings with no
  placeholders, redefinitions. These are provably wrong, not stylistic.
- **Include a subset of `B` (flake8-bugbear).** B006 (mutable default), B002, B012 and similar are
  genuine bug patterns. Select individually rather than enabling `B` wholesale — some bugbear rules
  are opinionated.
- **Exclude `E`/`W` (pycodestyle) entirely.** Line length, whitespace, indentation. This is the
  formatting category the trust rules forbid, and it would be the loudest output on any real project.
- **Exclude `I` (isort).** Import ordering is a project convention, not a defect.

Ruff's default is `E4,E7,E9,F` — the `E` portion must be turned off explicitly for the bundled tier.
A workspace with its own `ruff.toml` keeps its own selection untouched (tier 1, ADR-007).

## Acceptance criteria for "Python complete"

Both `python-ruff` samples must pass the full pipeline — analyze, explain, repair, verify, apply,
re-analyze — through the real application, the same bar TypeScript met.

`broken-python/stats.py` is **explicitly excluded** from Ruff acceptance and moved to Tier 3
acceptance. It is a good tier-3 case precisely because it is a defect a developer would immediately
recognise and no deterministic analyzer can prove.

## Status

**VERIFIED 2026-07-19** against the vendored Ruff 0.15.22, run with the analyzer's own rule selection
(`--select F,B006,B012,B018,B020 --isolated --no-cache`):

```
mutable_default.py L7:24 [B006] Do not use mutable data structures for argument defaults
undefined_name.py  L6:5  [F841] Local variable `total` is assigned to but never used
undefined_name.py  L7:12 [F821] Undefined name `totl`
```

Both predicted rules fired at the predicted locations. The extra F841 is a true positive rather than
noise: the typo means the correctly-spelled `total` genuinely is never read.

Detection is confirmed. The remaining gate items for Python — explain, repair, verify, apply,
re-analyze through the real application — are **NOT VERIFIED**.
