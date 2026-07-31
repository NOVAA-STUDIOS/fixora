# Advanced Repair — Design

**Status:** APPROVED, implementing milestone by milestone.
**Baseline:** `main` @ `7d7b284`

## What this is not

Not a bigger `ai-file` (whole-file rewrite). `ai-file` stays exactly as it is today — a separate,
unchanged mode — because some users want that blunt tool and removing it would be a regression.
Advanced Repair is a new `RepairMode: 'advanced'`, additive to the schema.

## The one thing that makes this safe: reuse, not new trust

Everything downstream of "here is a repairedCode string for this line range" is **completely
unchanged**: `parseRepairOutput` → `verification.verify()` (overlay, splice, re-parse, re-analyze
the *whole file*, `computeVerdict`) → the Apply gate. Advanced Repair only changes what goes **into**
that pipeline: a smarter target range and a richer prompt. It adds no new way for an unsafe patch to
reach disk.

## Root-cause grouping (new, pure, deterministic — no model call)

`packages/core-analysis/src/repair/root-cause-grouping.ts`. Given all findings in a file, produces
groups without ever calling a model — grouping is not a place to spend trust, verification is.

Two strategies, both narrow and defensible, never a generic "these seem related" guess:

1. **Identifier groups** (the textbook case: "missing import → 20 diagnostics disappear"). Reuses
   `extractUndefinedName`/`isUndefinedNameRule` from `symbol-resolution.ts` (already shipped,
   already tested) — findings on `TS2304`/`F821` that name the *same* undefined identifier are one
   group. Root cause = earliest occurrence.
2. **Scope groups.** Findings whose resolved scope (`enclosingRange` ?? `enclosingSymbol.location`
   ?? own location — the exact precedence `ai-service.ts` already uses for `target`) overlaps are one
   group, ranked by a small, documented priority table (syntax/parse > undefined-name > everything
   else by severity). This is the same "scope" concept `related-scope` mode already uses, just also
   used to pick which member is the root cause.

**The target range starts at the root cause's own scope, and how far it may widen depends on WHY the
group was formed** — the two strategies earn different trust:

- **Identifier groups**: members merge only if already *contained inside* the root cause's own scope
  (mirrors `related-scope`'s merge rule exactly, including never absorbing a `manual`-repair finding).
  Independent, scattered occurrences of the same name are not proof the code *between* them is safe
  to rewrite, so the target never widens to reach them — they stay `affected`, reported to the model
  as context and checked by re-analysis afterward, never spliced.
- **Scope groups**: membership itself is the proof — findings only end up in the same scope group
  because their ranges transitively overlap, i.e. they already sit in one contiguous, adjacent region.
  The whole group merges and the target unions across it, which is the coherent, non-fragmented patch
  the design calls for rather than an unproven guess.

`estimatedDiagnosticsRemoved` is the `affected` count, labeled as an estimate everywhere it is shown,
because whether it actually clears is what verification, not the grouping, decides.

**Known, stated limitation:** grouping does not infer cross-rule causality (e.g. "this type error was
probably caused by that missing import elsewhere"). Only same-identifier and same-scope relationships
are ever claimed. Overclaiming here is the unsafe move this design avoids.

## Model selection and failover

Reuses Milestone 3's routing (`estimateComplexity`/orchestrator `task`) with complexity forced to
`'high'` — Advanced Repair is definitionally the complex case — and reuses the existing
`orchestrator.run()` failover walk unchanged. **Failover triggers only on provider-availability
failures**, per `shouldFailover`; a verification rejection is reported, never retried automatically.

## Milestones

1. Root-cause grouping (pure, core-analysis) + tests — no wiring yet.
2. Wire into `ai-service.ts` as mode `'advanced'`: build the group, target its root cause's scope,
   route through the unchanged prepare/orchestrator/verify chain.
3. Repair Confidence / Root Cause View — additive UI fields on the repair proposal.
4. Full regression gate + certification + manual-validation notes.

Each commits separately; the full desktop + core-analysis suites run after every one.
