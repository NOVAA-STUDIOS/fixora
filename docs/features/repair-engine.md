# Repair Engine — Audit A5 remediation

Fix from the A5 beta-readiness audit of the Repair engine: the one genuine beta blocker found,
scoped, per instruction, to a wording-only change.

## The "Verified" claim now discloses its actual scope

Verification re-analyzes the **one file a repair changes** — it re-parses the patched file and
re-runs the same analyzers against it, comparing before/after findings. It does not, and
architecturally cannot cheaply, re-analyze the rest of the project. A repair that changes a
function's signature in a way that breaks a caller in a *different* file would still show as
"Verified," because that caller's file is outside verification's scope.

The user-facing copy previously didn't say so: "the finding is resolved and nothing new broke"
(`docs/USER-GUIDE.md`) and "The analyzers were re-run against this change and found no new
problems" (the verdict banner) both read as an unscoped, project-wide guarantee — stronger than
what was actually checked.

Every place this claim reaches the user now names the file explicitly, without changing what is
actually verified or how Apply is gated:

- `apps/desktop/src/features/ai/verdict-banner.tsx` — the default "Verified" reason (shown when the
  backend didn't supply its own `note`) now reads "The analyzers were re-run against this file and
  found no new problems in it."
- `apps/desktop/src/features/ai/apply-diagnostics.ts` — both the verifier gate's `pass` detail and
  the top-level "verified" gate explanation are scoped the same way ("re-ran on this file", "no new
  problems in it").
- `docs/USER-GUIDE.md` — the verdict-badge descriptions for Verified/Regression/Unresolved all now
  name the file explicitly ("this file", not "your project").

## What did not change

Per the audit's explicit instruction, this is a wording-only fix. No change to: verification's
actual scope (still single-file — cross-file/whole-project verification is a real, larger project
that was explicitly out of scope here), the gate logic that decides whether Apply is enabled, the
diff/preview mechanism, multi-file repair support (still deliberately absent), or test coverage
beyond proving the new wording is what actually renders.

## Testing

`verdict-banner.test.tsx` and `apply-diagnostics.test.ts` each gained one test asserting the
"Verified" copy names the file and no longer contains the old unscoped phrasing — narrowly scoped
to this fix, not a broader test-coverage expansion.
