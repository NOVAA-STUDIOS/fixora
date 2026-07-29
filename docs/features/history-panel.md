# Repair History Panel — Audit A9 remediation

Fix from the A9 beta-readiness audit of the Repair History panel: the one genuine beta blocker
found, scoped, per instruction, to exactly that fix.

## "Re-run repair" no longer offers itself on a Proceed-sourced entry

Since Audit A6, a Proceed edit is recorded into the same `RepairHistoryRepository` Repair uses, so
its history rows can carry `source: 'proceed'` and a synthetic `findingId`
(`proceed:<file>:<startLine>-<endLine>`) instead of a real analyzer finding id. The History panel's
row template didn't distinguish the two: every row, Repair or Proceed, offered the same "Re-run
repair" context-menu action, which re-runs `ai:run('repair', entry.findingId)`.

For a Proceed row this always failed: `findings.getByFindingId` looks up the `findings` table by
that synthetic id, which was never inserted there, so the lookup always returned `null` and the user
saw "That finding is no longer available." — a message that specifically implies the finding used
to exist and has since been cleaned up, which is false. It was never a finding to begin with.

`HistoryRow` (`apps/desktop/src/features/history/history-panel.tsx`) now computes
`isProceedEntry = entry.source === 'proceed'` and omits the "Re-run repair" menu item entirely for
those rows. "Open result" and "Copy repaired code" are unaffected — both are safe and meaningful for
a Proceed edit too, since they only read `entry.file`/`entry.repairedCode`, never `entry.findingId`.

## What did not change

Per the audit's explicit instruction, this is a single, narrowly-scoped UI fix. No change to:
`RepairHistoryRepository`'s schema or recording logic (already correct since A6), the missing diff
view for `entry.originalCode` (a real gap, but a separate, deferred finding), the silent
delete/clear failure handling, the 200-row history cap, or migrating the entry list to `VirtualList`
— all explicitly deferred, not implemented here.

## Testing

`history-panel.test.tsx` (new — no test file previously existed for this component) proves the fix
with two focused tests: a Proceed-sourced entry never renders "Re-run repair" in its context menu
while still offering "Open result"/"Copy repaired code"; a real Repair-sourced entry still offers
"Re-run repair" as before, proving the fix is correctly scoped and doesn't regress the normal case.
