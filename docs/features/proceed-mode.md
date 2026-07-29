# Proceed Mode — Audit A6 remediation

Fixes from the A6 beta-readiness audit of Proceed Mode: the two genuine beta blockers found, both
reusing machinery Repair already has, per instruction.

## Proceed edits now leave the same audit trail Repair does

Every reviewed Repair attempt — verified, unresolved, or regression — is recorded in the local
`RepairHistoryRepository` at generation time, whatever the verdict. Proceed edits went through the
identical write path (`ai:applyRepair`) and share the same BUG-002 data-integrity risk (see
`docs/BUGLOG.md`), but recorded nothing: an accepted, rejected, or regressed Proceed edit left no
trace to investigate after the fact.

`createProceedService` now takes the same `RepairHistoryRepository` Repair uses (wired through
`registerProceedHandlers` from the same instance in `index.ts`) and calls `history.record(...)`
once verification finishes, before branching on the verdict — so a regression that gets refused is
recorded too, not just an accepted edit. A Proceed edit has no analyzer `Finding` behind it, so the
finding-specific columns (`findingId`, `ruleId`, `source`) get descriptive synthetic values
(`proceed:<file>:<startLine>-<endLine>`, `'proceed-edit'`, `'proceed'`) rather than a schema change —
`repairs.finding_id`/`rule_id`/`source` carry no uniqueness constraint, unlike the `findings` table.
The returned `historyId` is echoed back in the `ok` proposal, mirroring Repair's own contract.

## Unhandled Proceed exceptions no longer leak raw error text

`proceed:run`'s catch-all used to return `error.message`/`String(error)` verbatim to the renderer —
a raw JS error (potentially a stack-trace fragment) instead of Repair's actionable, non-generic
wording. It now calls the same `describeRunFailure()` Repair's `ai:run` uses: an authored
`UserFacingError` still surfaces verbatim, and everything else becomes "Fixora could not finish this
edit... Details: \<the real detail\>... please report it," never a bare "internal error."

## What did not change

Per the audit's approved scope, this is a two-fix remediation: no change to intent classification,
scope resolution, context construction, the edit prompt/schema, verification, the apply path, or
cancellation. Every other A6 finding (see `PROJECT_STATUS.md`'s Beta Readiness Audits table) was
explicitly deferred — non-blocking UX/test-coverage items, and pre-existing tracked debt — and
remains untouched.

## Testing

`proceed-service.test.ts` gained two tests proving history is recorded for both a verified and a
rejected (regression) edit. A new `proceed-handlers.test.ts` proves the real `proceed:run` handler
(real temp workspace, no Electron) now returns `describeRunFailure`'s templated wording on an
unexpected error and still passes an authored `UserFacingError` through verbatim.
