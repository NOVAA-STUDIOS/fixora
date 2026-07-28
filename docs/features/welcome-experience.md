# Welcome Experience (Sprint F2)

A premium first-run and startup experience: a splash that never waits longer than it has to, and a
Welcome/Home screen shown whenever no project is open — hero, Quick Actions, and a pinnable Recent
Projects list.

## Splash screen

`apps/desktop/src/features/shell/splash-screen.tsx` + `use-splash.ts`. Renders inside the renderer
(not a second `BrowserWindow`) as an overlay on top of `AppShell`, which mounts underneath it from the
first frame — initialization runs concurrently with the splash being painted, never gated behind it.

**Bounded, not artificial.** An earlier version held the screen open for a fixed 3.5s "so it could be
read." A later revision removed the floor entirely, which turned out to cut the staggered
logo/wordmark/tagline entrance animation off mid-motion on a fast machine. The current behaviour is
the middle ground: `SPLASH_MIN_VISIBLE_MS` (1800ms) is a floor bounded at roughly what the entrance
animation itself needs to finish playing (~1.3s) plus a moment to read "Ready" — never a multi-second
"premium" wait manufactured on top of that. Whichever is later, work finishing or the floor elapsing,
governs when the closing fade (`SPLASH_FADE_MS`, 300ms) starts. If initialization takes ten seconds,
the splash stays up for ten seconds; if it takes ten milliseconds, the splash still stays up for the
~1.8s floor so the animation reads as intentional, then closes. A retry uses a shorter floor
(`SPLASH_RETRY_MIN_MS`, 900ms) — the user has already seen the brand once and is now actively waiting
on something they asked for.

The loading indicator (the indeterminate sweep) is gated on a separate `working` flag, not on
visibility: it disappears the instant initialization actually resolves, even during the brief
remainder of the floor while the splash is still on screen. A spinner still moving after the work it
represents has finished would be its own small dishonesty.

A status line (`SPLASH_MESSAGES`) paces itself against real progress (`onStage('workspace' | 'files')`
callbacks) — a message is never shown before the step it names has actually happened.

A failure is shown immediately (no floor), with **Try again** (re-runs `initialize`) and **Continue
anyway** (dismisses into the app with no workspace open) — a launch screen with no exit would leave
the user unable to even reach Settings.

The running app version is fetched via `system:getAppInfo` in `App.tsx` and passed down; it renders
under the tagline once fetched, and simply doesn't appear before then (no placeholder flash).

## Welcome / Home screen

`apps/desktop/src/features/shell/home-screen.tsx`, shown by `workbench.tsx` whenever
`workspace-store`'s `workspace` is `null` (except for Settings/Diagnostics/Suggestions, which stay
reachable with no project open). One surface, one job: open a project.

- **Hero** — brand mark, tagline, primary **Open folder** CTA, a command-palette hint, and an error
  line if the last open attempt failed.
- **Quick Actions** (`quick-actions.tsx`) — four equally-weighted entry points: **Open folder** (same
  action as the hero, for anyone scanning this row instead), **Open recent** (a popover listing the
  five most recent projects, fetched lazily on first open — never on every Home screen paint),
  **Documentation**, and **What's New**.
- **Recent Projects** (`recent-projects.tsx`) — cards showing name, path, and a relative last-opened
  timestamp, with a hover-reveal remove button and a full context menu (open, reveal in file explorer,
  copy path, remove, clear all).

## Pin support

A pinned project sorts to the top of Recent, ahead of everything ordered by recency.

- **Schema**: migration v6 adds a single nullable `pinned_at` column to `workspaces` — non-null means
  pinned, and doubles as the pin-order key (most-recently-pinned first), rather than a separate
  boolean plus a second ordering column.
- **Repository**: `WorkspaceRepository.recent()` orders `pinned_at IS NULL, pinned_at DESC,
  last_opened_at DESC`; `setPinned(id, pinned)` sets or clears the column.
- **IPC**: `workspace:setPinned` (request `{ id, pinned }`, response `{ workspaces }`) — same trust
  shape as `workspace:removeRecent`: the renderer supplies an id, never a path, so this cannot be aimed
  at an arbitrary folder even from a hostile renderer. It is a list-ordering preference, not a security
  fact.
- **UI**: a pin toggle on each `RecentCard` (always visible when pinned, hover/focus-reveal otherwise,
  same convention as the existing remove button) plus a "Pin project"/"Unpin project" context-menu
  item.

## Documentation and What's New

Both open **in-app dialogs**, not external links — they work with no network connection and need no
addition to the `shell.openExternal` host allowlist.

- **`documentation-dialog.tsx`** — a condensed, hand-authored rendering of `docs/USER-GUIDE.md`'s
  steps. Not a live file read or a Markdown parser: the guide is short and changes rarely, and the app
  ships with zero Markdown/HTML-rendering dependencies today. Kept manually in sync with
  `docs/USER-GUIDE.md` — update both together.
- **`whats-new-dialog.tsx`** — a short, hand-maintained highlight list plus the current build version
  (`system:getAppInfo`, fetched lazily when the dialog opens). Kept manually in sync with
  `CHANGELOG.md`'s `[Unreleased]` section.

## Testing

- `use-splash.test.ts` — the no-floor closing contract: closes immediately on success, stays up for
  as long as initialization genuinely runs, shows/holds an error immediately, message pacing never
  ahead of real progress.
- `workspace-service.test.ts`, `workspace-handlers.test.ts` — pin/unpin at the service and IPC layers,
  including sort-order transitions.
- `recent-projects.test.tsx` — pin/unpin controls and sort order in the renderer.
- `quick-actions.test.tsx` — Open folder delegation, Open recent's lazy fetch/empty state/select, and
  that Documentation/What's New open their dialogs.
- `documentation-dialog.test.tsx`, `whats-new-dialog.test.tsx` — dialog content and open/close.
- `home-screen.test.tsx` — a composition smoke test proving the hero, Quick Actions, and Recent
  Projects mount together.
