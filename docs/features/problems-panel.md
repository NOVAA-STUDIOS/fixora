# Problems Panel — Audit A4 remediation

Fixes from the A4 beta-readiness audit of the Problems panel (Findings UI). Scope: the three
genuine beta blockers found — no error state, no working keyboard activation, and a silent
count/list mismatch when the backend's row cap truncates a result set.

## Error state

`findings-store.ts` already tracked `status: 'error'` and a failure `message`, but
`findings-panel.tsx` never read either — a failed run fell through to whichever generic empty
state happened to apply, or left a previous run's now-stale findings on screen with nothing
marking them as the product of a failed attempt.

The panel now renders a `role="alert"` banner (`Analysis failed` + the actual message + a
"Try again" button) whenever `status === 'error'`, positioned above whatever else is showing —
the empty state or a stale list — rather than replacing it. `run()` already clears `error` the
instant a retry starts, so the banner disappears on its own; nothing new was added to manage its
lifecycle.

## Keyboard navigation

`VirtualList` (fixed for the file tree in the A2 remediation) carries `role="listbox"`/`role="option"`
and a full keyboard contract — Arrow Up/Down, Home/End, Enter/Space, a roving
`aria-activedescendant`, scroll-into-view — but the Problems panel was the one consumer that never
wired the keyboard half of it: `onActivate` was never passed, and each row remained an individually
tabbable `<button>`.

Both are now fixed, mirroring `file-tree.tsx`'s pattern exactly:

- `FindingsPanel` defines `activate(finding)` once (select + `revealAt`) and passes it as
  `VirtualList`'s `onActivate` **and** as `FindingRow`'s `onActivate` prop — one definition, both
  the keyboard and the mouse path call it.
- `FindingRow`'s row button is now `tabIndex={-1}` — the `VirtualList` container is the single tab
  stop, exactly as a native `<select>` behaves, instead of every visible row competing for its own
  stop (which also meant Tab broke down past whatever the virtualizer currently had mounted).

The row's secondary action buttons (Explain/Repair/Test/Ignore) are unchanged — they remain
individually reachable via Tab once focus reaches a row's revealed actions, which was not part of
this fix's scope.

## Findings-count trust

`repositories.ts`'s `list()` defaults to `limit = 500`; `findings-store.ts` never overrides it. The
status bar and the panel's own severity-filter tabs read `summary` — a true, unfiltered-by-limit
count — so a workspace with more than 500 matching findings could show "N problems" in the header
while the actual scrollable list silently stopped at 500, with no indication anything was cut.

Rather than build pagination (out of this fix's scope — the audit explicitly offered "pagination"
or "a disclosure" as alternatives, and a disclosure is the correct minimal, correctness-only fix
here), the panel now compares the fetched page's length against the true count **for whichever
severity is currently selected** (`summary.total` for "All", `summary.bySeverity[sev]` for a
specific severity — the only filter the UI exposes) and, only when they disagree, shows:

> Showing 500 of 812 problems. Narrow by severity to see the rest.

This is a plain read of existing data — no new IPC call, no new backend query, no change to
`repositories.ts`'s query shape.

## Testing

`findings-panel.test.tsx` (new): the error banner appears with the real failure message and
survives alongside stale findings, "Try again" re-invokes `analysis:run`, the truncation banner
appears only when the fetched page is shorter than the relevant true count (checked against both
the "All" total and a specific severity's total), rows carry `tabIndex={-1}`, and Enter on the
keyboard-roving active row calls `revealAt` with that row's location and updates `selectedId` —
mirroring `file-tree.test.tsx`'s keyboard-operability tests.

## Deferred (not part of this fix)

Per audit A4's non-blocking findings, left untouched: no search/sort/grouping UI, the refresh UX
(stale results remain visible, unmarked, for the duration of a re-run beyond the new error banner),
per-row hook fan-out, and the lack of a scale test analogous to the file tree's 10,000-file
acceptance test.
