# Python production acceptance

Workspace: `samples/python-ruff/` — open this folder, not the repo root.

Python must clear the same gate TypeScript did. Detection is already verified against the vendored
Ruff 0.15.22 (see `PYTHON-BENCHMARK-AUDIT.md`); everything below needs the real application.

## Expected findings

| File | Line:Col | Rule | Owner |
|---|---|---|---|
| `mutable_default.py` | 7:24 | B006 — mutable data structure for argument default | Linter |
| `undefined_name.py` | 7:12 | F821 — undefined name `totl` | Linter |
| `undefined_name.py` | 6:5 | F841 — `total` assigned but never used | Linter |

F841 is a true positive, not noise: the typo means the correctly-spelled `total` is genuinely never
read. Repairing F821 should resolve F841 as a side effect — worth watching, because it is the first
case where one repair is expected to clear two findings.

## Checklist

| # | Gate | Pass | Evidence to record |
|---|---|---|---|
| 1 | Workspace opens | ☐ | folder name in Files panel |
| 2 | Analyze runs | ☐ | no crash, no freeze |
| 3 | All three findings appear | ☐ | file, line, column, rule id for each |
| 4 | Explanation is accurate | ☐ | see below |
| 5 | Repair returns a patch | ☐ | or the provider error, verbatim |
| 6 | **Indentation preserved** | ☐ | see below — the highest-risk gate |
| 7 | Verification produces a verdict | ☐ | verified / regression / unresolved |
| 8 | Apply enabled only if verified | ☐ | button state vs. verdict |
| 9 | Re-analyze runs | ☐ | finding count after |
| 10 | Finding gone, nothing new | ☐ | remaining findings |

## The two gates that actually carry risk

**Gate 6 — indentation.** Python is the first indentation-sensitive language to go through
`spliceLines`. That apply path is language-agnostic and has only ever run against TypeScript, where
indentation is cosmetic. Here, a splice that gets whitespace wrong produces a file broken in a *new*
way. Tree-sitter should catch it as `syntaxOk: false` → `regression` → Apply disabled, so the gate
should hold — but **that gate has never been exercised on Python**. If it holds, that is a genuine
result worth recording. If a mangled-indentation patch reaches `verified`, stop: it is a cross-language
defect in the apply path that would affect every indentation-sensitive language added afterwards.

**Gate 4 — explanation quality.** For B006, an accurate explanation says the list is created **once at
function definition** and therefore shared across calls that omit the argument. An explanation that
only says "avoid mutable defaults" restates the rule name without conveying the bug, and should be
recorded as a fail — the product's claim is that it explains *why*, not that it echoes a linter.

## Known obstacles

- The OpenRouter 403 quota may block gates 5–10 entirely. If so, record it and Python stays
  incomplete rather than being marked passed on partial evidence.
- Two findings in `undefined_name.py` — confirm repairing one does not disturb the other.

## Outcome

Python is production-complete only when gates 1–10 all pass. Anything less is recorded as partial,
and HTML does not start.
