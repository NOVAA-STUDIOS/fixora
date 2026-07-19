# Engineering Specification

The project's engineering constitution. Updated after every completed milestone.

Where this document and an ADR disagree, the ADR wins and this document is wrong — ADRs record
decisions, this records the current state produced by them.

**Last updated:** 2026-07-19, after Ruff vendoring.

---

## 1. Supported languages

| Language | Tier 1 (workspace) | Tier 2 (bundled) | Tier 3 (AI) | Status |
|---|---|---|---|---|
| TypeScript | eslint, tsc | eslint, tsc | planned | **Proven end-to-end** |
| React (TSX) | eslint + react-hooks | eslint + react-hooks | planned | Analysis + rejection proven |
| JavaScript | eslint | eslint, tsc (checkJs) | planned | Analysis proven; see §9 |
| Python | ruff, mypy | **ruff (vendored 0.15.22)** | planned | **Detection complete, repair acceptance pending** |
| Go | go vet | none planned | planned | Tier 1 only |
| HTML | none | *(not implemented)* | — | **Not started** |
| CSS | none | *(not implemented)* | — | **Not started** |
| JSON | none | *(not implemented)* | — | **Not started** |

"Proven" means the full pipeline — analyze, detect, explain, repair, verify, apply, re-analyze — has
been observed working in the real application, not in a test harness.

---

## 2. The three tiers

Resolution is strictly ordered. A tier is only reached when the one above it produces nothing.

**Tier 1 — the workspace's own tools.** Resolved from the project's `node_modules` or PATH. This tier
is inviolable: ADR-007 forbids contradicting the user's CI, and a repo with its own ESLint must never
be analyzed by ours. There is a test asserting exactly this; it must never be relaxed.

**Tier 2 — Fixora's bundled copies.** Reached only when the workspace has no tool of its own. This is
a refinement of ADR-007 rather than a reversal: a folder with no ESLint has no CI opinion to
contradict. Before tier 2 existed, a plain folder had zero active analyzers and reported zero
findings — the product's core promise did not function for anyone who had not already installed a
linter.

**Tier 3 — AI semantic reasoning.** Not implemented. Exists only for defects deterministic analyzers
cannot prove. It never duplicates a deterministic finding and never runs where tiers 1–2 have spoken.

---

## 3. Deterministic scope

What the deterministic tiers can prove, and therefore own:

- Syntax errors, unreachable and dead code
- Undefined names, unused variables, missing imports, invalid exports
- Type incompatibilities, invalid property access, wrong argument counts
- Null/undefined misuse (via `strictNullChecks`)
- Array index safety (via `noUncheckedIndexedAccess`)
- React Hook rule violations and missing effect dependencies
- Known-bad constructs (mutable default arguments, `no-cond-assign`, `use-isnan`)

## 4. AI scope (Tier 3)

What only semantic reasoning can reach:

- Off-by-one errors and incorrect loop bounds
- Wrong algorithms and missing edge cases
- Incorrect state updates and suspicious async flows
- Business logic inconsistencies

**Tier 3 may never emit a Confirmed finding** (§6) and may never enter the verification baseline
(§7).

---

## 5. Benchmark ownership

Every benchmark case declares the subsystem responsible for solving it. **A case fails only if its
correct owner fails.** Ruff is never marked failing for a semantic bug; AI is never marked failing for
a syntax error.

| Case | Defect | Owner | Rule |
|---|---|---|---|
| `broken-ts/average.ts` | off-by-one index | **Type Checker** | TS2532 |
| `broken-react/Counter.tsx` | missing effect deps | **Linter** | react-hooks/exhaustive-deps |
| `broken-js/total.js` | off-by-one index | **Tier 3 AI** | none — see §9 |
| `broken-python/stats.py` | off-by-one index | **Tier 3 AI** | none — see §9 |
| `python-ruff/undefined_name.py` | typo'd identifier | **Linter** | F821 *(unverified)* |
| `python-ruff/mutable_default.py` | mutable default arg | **Linter** | B006 *(unverified)* |

Owners are: Compiler, Type Checker, Linter, Validator, Tier 3 AI.

Misclassification is a real risk with real cost: had Ruff been implemented against the original Python
benchmark, it would have shipped with zero passing cases, and that would have read as a broken
integration rather than a misclassified benchmark.

---

## 6. Confidence model

Enforced by the schema, not by convention. `packages/shared-types/src/analysis.ts` makes `ai` the only
`FindingSource` permitted a `confidence` below 1.0.

| Level | Source | Confidence | Meaning |
|---|---|---|---|
| **Confirmed** | any deterministic tool | `1.0` | A compiler or linter proved it |
| **High Confidence** | `ai` | high | Strong inference, supported by deterministic context |
| **Medium Confidence** | `ai` | moderate | Likely, requires developer review |
| **Suggestion** | `ai` | low | Non-critical improvement |

The UI rule follows directly and needs no new field: **`source !== 'ai'` renders as proven, `ai`
renders as inferred.** AI inference must never be presented as compiler truth.

---

## 7. Verification rules

`computeVerdict` (`apps/desktop/electron/main/verification/patch.ts`), in order:

1. `!syntaxOk` → **regression** — "The fix does not parse."
2. new findings introduced → **regression** — the patch resolves one problem and creates others
3. target finding resolved → **verified**
4. otherwise → **unresolved**

Verification runs on a throwaway overlay (ADR-003). It never touches the user's files. Apply is
disabled for `regression`.

**Invariant:** an `ai`-sourced finding must never enter the verification baseline. If it did,
"verified" would quietly degrade to "the analyzers and a guess both stopped complaining."

### Presentation

A rejected patch must never resemble an applied one. The verdict banner states the outcome first, the
word "verified" appears only when the verdict is, and any non-applied outcome states plainly that the
source file was not modified. This is enforced by tests asserting wording, not markup.

---

## 8. Repair quality

Every repair must preserve identifiers, exports, imports, comments, formatting, project conventions,
and surrounding code, and make the smallest edit that fixes the defect. Verification rejects patches
that break parsing or introduce new diagnostics — but note it cannot catch a *semantically* wrong
patch that still passes both gates (e.g. `[]` instead of `[start]` in a dependency array). That gap is
the reason the confidence model exists.

---

## 9. Unsupported cases — stated explicitly

**An off-by-one in an untyped language is not reachable by static analysis.** This is a property of
the languages, not a gap in the implementation:

- `broken-js` — `noImplicitAny` is deliberately off (see §11), so `items` is `any`, `items[i]` is
  `any`, and no index check applies. Enabling it would report the untyped parameter, not the bug.
- `broken-python` — Ruff reasons about names, imports and known-bad constructs, not about whether a
  loop bound matches a sequence length.

Both are Tier 3 cases. **Do not add benchmark-specific rules to force them green.**

Python's deterministic ceiling is structurally lower than TypeScript's: TS gets a linter *and* a type
checker; Python gets a linter, because mypy is tier-1 only and is not bundled.

---

## 10. Security rules

- **BYOK only.** The key is encrypted with the OS keychain, read only in the main process, and never
  crosses IPC. Requests go straight to the provider; nothing is proxied through a Fixora server.
- **Never download executables at runtime.** Bundled binaries are acquired at build time, from the
  official upstream source, at a pinned version, with SHA256 verified **before** unpacking, failing
  the build on mismatch.
- **Never trust unofficial npm wrappers.** `@astral-sh/ruff` does not exist on npm; a package named
  plain `ruff` exists at a version inconsistent with upstream. Ruff must come from Astral's GitHub
  releases.
- Renderer stays sandboxed with `contextIsolation`; CSP has no `unsafe-eval`/`unsafe-inline` in
  `script-src`; IPC is zod-validated in both directions.
- Analysis never writes to the user's workspace. Generated configs live in the OS temp directory.

---

## 11. Analyzer configuration policy

**Every bundled rule must flag a defect, not a preference.** A false positive on taste destroys trust
in an analyzer the user never asked to run.

- **ESLint (bundled):** correctness rules only. No quotes, semicolons, indentation, or import order.
- **tsc (bundled):** `strictNullChecks` + `noUncheckedIndexedAccess`, **not** `--strict`. Full strict
  implies `noImplicitAny`, which on an untyped JS folder emits one error per unannotated parameter —
  hundreds of diagnostics, none of them a bug the user has.
- **tsc (bundled):** module-resolution diagnostics (TS2307/TS2875/TS7016/TS2688) are suppressed. A
  folder with no `node_modules` reports "Cannot find module" for every import — a fact about the
  user's install, not their code. Tier 1 still reports them.
- **Ruff (planned):** `F` in, hand-picked `B` in, `E`/`W` (pycodestyle) and `I` (isort) out. Ruff's
  default includes `E`, so it must be disabled explicitly.
- **No duplicate reporting.** `noUnusedLocals` is off because ESLint already covers it; one defect
  must not become two findings.

---

### Interim status vocabulary

A language sitting between "not started" and "complete" is recorded as **Detection Complete, Repair
Acceptance Pending**. It exists so partial progress is never rounded up: detection passing is not the
gate, and a language is complete only when all nine items in §12 pass.

## 12. Release gates

A language is complete only when it passes **all** of: analyze, explain, repair, verify, apply,
re-analyze, benchmark, regression tests, manual acceptance.

Languages ship one at a time, gated on production quality rather than feature count.

Repository-wide gates: all tests green, 12 lint tasks clean, typecheck clean, dependency-cruiser zero
violations, gitleaks, electronegativity, WCAG 2.2 AA contrast, ADR sync, `pnpm gate:website`.

**Benchmark failure blocks release.** Target coverage: JS 50+, TS 50+, React 30+, Python 30+, HTML
20+, CSS 20+, JSON 20+ — each recording detected / explained / repaired / verified / applied /
re-analyzed.

---

## 13. Open work

In order. Do not start the next before the current one reaches production quality.

1. **Python** — vendoring and detection are done; F821/B006/F841 confirmed against the vendored
   binary. **Blocked on manual acceptance** (`PYTHON-ACCEPTANCE.md`), which needs the real
   application. Status is *Detection Complete, Repair Acceptance Pending* — deliberately not
   "complete", because the repair half has never run. Highest risk there: Python is the first
   indentation-sensitive language through `spliceLines`, and that path has only been exercised
   against TypeScript.
2. **HTML, CSS, JSON validators** — including the unexplained crash: `"path" argument must be of type
   string` on those three languages.
3. **Benchmark expansion** to the §12 targets.
4. **Tier 3** — per §4, §6 and the invariant in §7.

Known unresolved: the OpenRouter 403 quota blocking React's successful-repair path; five website
placeholder URLs requiring external accounts; clean-machine install acceptance.
