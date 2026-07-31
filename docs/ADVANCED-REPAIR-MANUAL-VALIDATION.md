# Advanced Repair — Manual Validation Notes

**Status:** Implementation complete (AR-M1–AR-M4), automated gates green. The items below need a human
in the running app — I cannot drive the GUI in this environment.

## Automated evidence already collected

- 1348 tests across the monorepo (220 core-analysis, 191 core-ai, 21 shared-types, 916 desktop), zero
  regressions at every milestone gate.
- Certification: 22/0, unchanged from before this sprint.
- Zero diff, since the pre-sprint baseline (`7d7b284`), under `verification/`, `apply-diagnostics.ts`,
  `parser/`, `analyzers/`, and `registry.ts` — the protected surfaces never moved.
- Dedicated tests prove the two things that matter most: a `regression` verdict on an Advanced Repair
  still returns as a regression (never bypassed), and the splice target for a scattered-identifier
  group lands on the root cause's own line, never a range spanning to where the user clicked.

## What needs a human

1. **Pick a real file with a genuinely missing import used several times.** Select Advanced Repair
   from a *non-root* usage. Confirm the panel: (a) shows "Advanced Repair" as the active mode, (b) the
   Root Cause View card appears with "different location", (c) the diff targets the import line, not
   the line you clicked.
2. **Run it on a finding that already IS the root cause.** Confirm the Root Cause View still appears
   but without the "different location" badge.
3. **Run it on an isolated finding with nothing to group.** Confirm no Root Cause View renders, and
   the patch is identical in size/shape to what `finding` mode would have produced for the same line
   (basis `singleton` collapses to ordinary single-finding behaviour).
4. **Force a rejection** (accept a bad patch if the model returns one, or use a low-quality model).
   Confirm Apply is disabled with the same messaging standard repair uses — Advanced Repair must not
   look "more trustworthy" than a normal rejection.
5. **Compare against `ai-file` mode on the same file.** Confirm `ai-file` is unchanged — still a
   whole-file rewrite, still separately warned, still selectable.
6. **Confidence and impact.** Confirm the existing confidence/impact chips on the patch card still
   read sensibly for an Advanced Repair proposal (they were not mode-specific before this sprint and
   needed no changes, but worth a look at a genuinely large coordinated patch).

## Known, deliberate limitations (not defects)

- Grouping infers relationships only from shared identifier or shared/overlapping scope — never
  cross-rule causality. A type error "probably caused by" an unrelated missing import elsewhere is
  never claimed.
- `estimatedDiagnosticsRemoved` is exactly that — an estimate from grouping, not a guarantee.
  Verification, after the fact, is the only thing that confirms what actually cleared.
- Proceed Mode is unaffected; Advanced Repair is a `RepairMode` value, reachable only through the
  Repair flow.
