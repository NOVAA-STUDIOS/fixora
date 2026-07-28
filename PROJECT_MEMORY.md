# Fixora — Project Memory

The things a new engineer (or a future me) would otherwise have to rediscover the hard way.
**This is not a summary of the blueprint.** The blueprint is in [docs/](./docs/) and it is the source of
truth. This file records what we _learned by building_, and the decisions we made that the blueprint did
not anticipate.

Updated after every milestone. Newest milestone first.

---

## Proceed Mode + reliability sequence (H1→Q3), branch `sprint-1/ui-stability` (2026-07-27)

Built after `v0.9.0-beta.1` was tagged; unreleased. Two parts: a new editing pipeline (Proceed Mode),
then four reliability/validation sprints (H1, Q1, Q2, Q3) run with the same audit-then-fix discipline as
the M0–M3 milestone reviews — one confirmed, reproduced defect at a time, smallest safe fix, regression
test, re-verify gates, human validation in the running app before calling anything closed.

### Proceed Mode reuses the Repair engine's verification — it does not fork it

The temptation with a second editing mode is a second verification path. Instead `computeVerdict` gained
one parameter, `target: Finding | null` — `null` means "edit mode: no finding to resolve, so the verdict
reduces to does it parse and introduce no new problems." The Repair call site is byte-identical to
before. One verifier, two callers, proven by the same test suite passing for both. The lesson generalises
from M3's "verify the workflow the user actually runs": when a second feature needs the guarantees the
first one already built, extend the primitive's parameter space before considering a fork.

### Q3 established four guarantees worth carrying into any future editing feature

- **Question-intent refusal.** A classifier can produce a category ("explanation") without every caller
  correctly treating it as non-actionable. The lesson: an intent classifier's output types are not
  self-enforcing — every consumer of "what kind of instruction is this" must be audited for the refusal
  branch, not just the happy-path branches. (`packages/core-ai/src/edit/intent.ts` classifies
  `explanation`; `proceed-service.ts`'s `run()` is what has to act on it.)
- **Proposal/file scoping.** A preview generated for file A must stop being acceptable the instant the
  user's active editor tab moves to file B — otherwise Accept can silently write to a file the user is no
  longer looking at. Enforced via a `useEditorStore.subscribe()` callback in `proceed-store.ts` that
  invalidates a pending preview on tab change, plus a same-file guard checked again when the async
  response actually lands (closing the race where the user switches tabs _while the request is still in
  flight_). The general lesson: any async proposal keyed to "the user's current context" needs the check
  re-run at delivery time, not just at request time — context can move in between.
- **Immutable Retry replay.** Retry must replay the _exact_ failed request, never reconstruct one from
  live editor state (cursor, selection, active tab) at the moment Retry is clicked. The fix: capture the
  full request object at send-time into store state; Retry resends that captured object, untouched. This
  generalises: any "try that again" action needs its own snapshot of the original inputs — "re-run with
  current state" and "re-run what actually failed" are different operations that look identical until a
  user moves the cursor between the failure and the click.
- **Real in-flight cancellation, with a staleness token.** Cancel must reach the actual in-flight
  operation (an `AbortController`, mirrored from Repair's already-proven `ai:cancel` pattern — one
  `active` controller held at IPC-registration scope, aborted and replaced on every new request), not
  just reset local UI state. Beyond that, a renderer-side monotonic `requestToken` — bumped by both
  Cancel and every new request — silently discards any result a superseded request resolves with later
  (a cancelled request's late reply, or an overtaken retry). The lesson: cancellation has two halves that
  are both required — stopping the operation, and discarding whatever it produces anyway if stopping
  didn't win the race.

### A data-integrity incident that hardening could close without finding the cause (BUG-002)

A test file was reduced to 60 bytes, every byte `0x00`, after an ordinary Proceed→Accept — reproducible
once, then not reproducible again across 8 varied controlled attempts (rapid repetition, CRLF/LF, a
concurrent editor with autosave, a UI double-click race, antivirus interference, duplicate processes —
each checked with real evidence, not assumed). **The important lesson is procedural, not technical:** a
serious incident that cannot be reproduced is not the same as a false alarm, and it is not something a
fix should be invented for on speculation. The correct response when the mechanism is unknown is a
**root-cause-agnostic invariant** — `verifyWrittenFile()` reads every write back and refuses to report
success if the bytes on disk don't match what was intended, regardless of what would have caused a
mismatch. This makes the _failure mode_ safe (loud and refused) without requiring the _cause_ to be
known, and it is intentionally the one place all three write paths (Repair apply, Proceed accept, manual
Save) converge — `writeTextFile` — so one guard covers all of them. Deliberately **no automatic
rollback**: a single read-back cannot distinguish "our own bug" from "a legitimate concurrent external
edit landed in the same window," and guessing wrong would destroy real work. BUG-002 stays open,
recorded in `docs/BUGLOG.md`, with temporary diagnostic instrumentation left active on purpose.

### Sequence and status, for anyone picking this branch back up

H1 (human validation) → Q1 (analyzer accuracy, 4 defects fixed) → Q2 (repair reliability, 2 fixes) → Q3
(Proceed stabilization, 4 defects fixed) → **Q3 formally frozen 2026-07-27** after all four defects passed
both automated gates and a 10-item human-validation checklist run against the real app. BUG-002 (open,
non-reproducible) and BUG-003 (`acceptance-scale.test.ts` flaking under parallel load, test-infra not app)
are both tracked separately and did not block the freeze. **No further `sprint-1/ui-stability` scope is
documented anywhere in this repo** — if there was more intended for this branch, it exists only outside
these files.

---

## Beta pivot + Beta-M5 — Verified AI Repair, BYOK (2026-07-17)

### The pivot: BYOK deletes the server from the critical path

The mission changed to shipping a Public Beta. The key realisation: **BYOK inverts what needs building.**
The whole `fixora-api` gateway (Supabase auth, quota, metering) and desktop PKCE sign-in exist to support
the _managed_ tier — our keys, our billing, so we must meter server-side. With bring-your-own-key the AI
call goes desktop→provider direct; there is no token to meter and no server on the AI path. So five phases
of backend work became a v1.1 asset (built, green, committed) and the beta got smaller and more private.
The lesson: when priorities change, re-derive the critical path from first principles — don't keep building
the plan you had.

### `core-ai` is pure, so it bundles into main; `core-analysis` is not, so it can't

M3 learned the hard way that `@fixora/core-analysis` must run in a utility process: it loads tree-sitter
WASM via `import.meta.url`, which only resolves as a real module in `node_modules`, never bundled into the
CJS main. `@fixora/core-ai` has none of that — it is pure logic — so it goes on the electron-vite `BUNDLED`
list and the BYOK provider call runs _direct from main_ (AI-Pipeline §3). The rule: a package can live in
main iff it has no runtime file/WASM resolution of its own.

### Verification reuses the finding's own enclosing symbol — no second parse in main

A repair is grounded on a stored `Finding`, and the finding **already carries** `evidence.enclosingSymbol`
(computed during M3 analysis). So main needs no tree-sitter to know the target range — it reads it off the
finding. Re-analysis of the patch happens in the worker (which has the engine), on a throwaway **overlay**:
copy the source, junction-link `node_modules` (a Windows junction needs no elevation), patch the one file,
re-run. The real files are never mutated to verify — a crash mid-verify must not leave a half-patched repo.

### Apply must verify the target range still matches, or it corrupts the file

Apply splices the repaired symbol into a **line range**. But the proposal was computed against a snapshot of
the file — if the user (or a formatter, or a git checkout) changes the file between "Repair" and "Apply", the
range is stale and splicing it silently corrupts the code. The audit caught this before any real use. The fix:
apply carries `expectedOriginal` (the exact text the range held at proposal time) and main **refuses if the
current range no longer matches**. Cheap, deterministic, and it turns a corruption bug into an honest "the
file changed, re-run the repair." The lesson: any operation that mutates a file by position must re-validate
the position against what it was computed for — position is not identity.

### Local SQLite is allowed to hold code — the audit trail keeps the before/after

The cloud schema forbids code, paths, and diffs (a CI test enforces the denylist). **Local SQLite is the
opposite** (DB §1: local holds everything about the user's code), so the repair history stores the full
original and repaired text, not just a verdict. That is what lets the History panel show a past fix and
"copy again" work long after the run — and it stays private because it never leaves the machine. The
audit trail records every reviewed repair regardless of verdict (a regressed or unresolved attempt is
part of the history too); Apply stamps the row applied. The lesson: the local/cloud code-retention line
is a hard, testable boundary — lean into it on the local side rather than being timid about storing code.

### Verdict compares by (source, rule, symbol), not the DB's snippet-sensitive id

The DB finding id intentionally includes a normalised snippet so it survives line shifts — but that means
_any_ code change gives every finding a new id, which would make every repair look like it introduced
"new" findings. The verification signature is `source:rule:enclosingSymbol` instead, so "the same problem"
survives the fix and a genuinely new problem stands out. Syntax break (tree-sitter `hasError`) is always a
regression, even when no analyzer runs — the honest floor when a project has no tools configured.

---

## M3 — Deterministic analysis engine (2026-07-16)

### Project-scoped tools must run once over the workspace, never once per file

`tsc`, `mypy`, and `go vet` need the whole program/package to resolve a type — they are project-scoped. The
first cut modelled every analyzer as per-file (`analyze(oneFile)`), so the engine invoked `tsc --noEmit` (a
full project type-check) **once for every file**: O(files × project). On this monorepo the app just sat on
"Analyzing…" forever. The fix was to make the analyzer contract **workspace-scoped** — `run(context)` is
called once, each tool spawns a single time (`eslint .`, `tsc --noEmit`, `go vet ./...`), and findings are
distributed back to their files. A shared per-run symbol cache parses each file once. The bonus is that this
is _also_ the correct grounding: running the user's own tool their own way, once, is exactly what their CI
does, so "findings match your CI" becomes a property of the architecture, not a hope. The lesson: before
choosing a per-item interface, ask whether the work is per-item — a project tool wearing a per-file interface
is a quadratic bug waiting to happen.

### Verify the workflow the user actually runs, not the one that's easy to script

Two separate black screens (M2's GPU one, M3's dev-server one) both hid because every "verification" I ran was
the **built** app (`electron .` on `file://`), while the user ran `pnpm dev` (the Vite dev server). They are
different renderers: the dev server injects an inline Fast-Refresh preamble the strict CSP blocks; the built
bundle has no inline script. The built app rendering told me nothing about `pnpm dev`. Always reproduce the
_standard developer path_, not a convenient proxy for it — and if you catch yourself with a "special internal
launch procedure," that gap is the bug.

### A strict CSP and Vite dev coexist via a nonce, not `unsafe-inline`

`@vitejs/plugin-react` injects `window.$RefreshReg$ = …` as an inline `<script>` in dev. `script-src 'self'`
blocks it → `$RefreshReg$` undefined → the transformed modules throw → black screen. Do **not** reach for
`'unsafe-inline'` (ADR-006 forbids it in every env). Vite's `html.cspNonce` stamps a nonce on the injected
scripts; allow `'nonce-…'` in the _dev_ CSP (a nonce is not `unsafe-inline` — the security property holds),
and strip the static production `<meta>` CSP in the dev server only so it doesn't also block it. Production
ships no inline script and is untouched.

### CJS main cannot `require` an ESM-only package — and importing its barrel runs its top-level code

Main is CJS (a sandboxed preload forces it). `@fixora/core-analysis` is ESM-only (`exports` has no `require`),
and its barrel runs `createRequire(import.meta.url)` at module load. A CJS `require()` of it threw
`ERR_PACKAGE_PATH_NOT_EXPORTED` before any window. The right fix was architectural, not a bundler flag: the
engine belongs in the isolated worker (ADR-017), so main imports **none** of it. When a privileged CJS process
"just needs one helper" from an ESM engine, that's the smell that the helper is on the wrong side of the
boundary.

### tree-sitter grammars are WASM data you ship — and a runtime dependency

Native tree-sitter would drag `node-gyp` and a per-Electron-ABI rebuild back in (the exact tax ADR-005/033
avoid). `web-tree-sitter` + prebuilt `tree-sitter-wasms` keeps the engine build-free. But the grammar `.wasm`
is loaded at **runtime** (via `createRequire`), so `tree-sitter-wasms` must be a `dependency`, not `dev`, and
packaging (M8) must unpack the `.wasm` from the ASAR — tree-sitter reads them as files.

---

## M2 — Workspace, editor, local persistence (2026-07-15)

### `node:sqlite` was the escape hatch when the native module had no prebuild (ADR-033)

better-sqlite3 is the obvious choice, and it was unbuildable here: Electron 43 is ABI v148, there is no
better-sqlite3 prebuild for it, and there is no C++ toolchain (or Python) on this machine to compile one.
Rather than make "install a compiler" a prerequisite for the repo, we used **`node:sqlite`** — the SQLite
that ships _inside_ Electron 43's Node 24. It is behind a `SqliteDriver` interface, so if a future Electron
drops it or a prebuild appears, swapping back is a one-file change. The lesson: when a native dependency
blocks the build, check what the runtime already bundles before you make the whole team install toolchains.

### Monaco under a strict CSP means bundling its workers, not its CDN

Monaco's default loader pulls from a CDN and uses `eval` — both forbidden by our CSP (Security §2). The
working recipe: import the **ESM** build, import each language/editor worker with Vite's `?worker` suffix
so they are bundled locally, and set `self.MonacoEnvironment.getWorker` to return those worker instances.
`worker-src 'self' blob:` in the CSP covers the blob URLs Vite generates. No CDN, no `unsafe-eval`, and it
renders a real file in the shipped app. If Monaco ever shows a blank editor, suspect the worker wiring
before anything else.

### The renderer must not choose the FS root — even a path it "got from a dialog" (M2 red-team)

`workspace:open` accepted the folder path from the renderer and made it the trusted filesystem root. The
path _originates_ in a native dialog, but it **round-trips through the renderer**, which is hostile by
assumption (I1) and can send any string instead. The bounded-but-real consequence: set root to `C:\`, then
read non-secret files under it. The fix is the general pattern for "user-authorized action the renderer
relays": main keeps the set of paths the user actually picked (plus known recents, which only got there
through a prior pick) and refuses anything else. Keep the trusted primitive (`open()`) for internal callers
and put the authorization check at the IPC boundary — do not weaken the primitive to satisfy a test.

### A black screen with a fully-rendered DOM is a compositing bug, not a render bug

The window launched black. The instinct is "React crashed" or "the bundle failed to load" — both wrong.
`FIXORA_DEBUG=1` instrumentation (DevTools auto-open + a `did-finish-load` DOM probe) showed `#root`
with a child and ~12 KB of `innerHTML`, the right `document.title`, and **no console errors**. The DOM
was fully there; it just was not on the screen. That signature — DOM present, window shows only its
background colour until a resize "fixes" it — is a **GPU compositing** failure on the driver, not a
renderer failure. The fix is `disable-gpu-compositing` on Windows (CPU composites, GPU still rasterises,
so Monaco stays fast), applied at module load before the GPU process starts. Two debugging lessons that
cost real time here: (1) always probe the DOM before assuming a render crash — the fix is completely
different; and (2) **do not "verify" a window by maximising it for the screenshot** — a resize is itself
a recomposite, so it hides the exact bug you are trying to see. Capture at natural size (PrintWindow
works without focus or resize) or you will report a black-screen bug as fixed when it is not.

### `ELECTRON_RUN_AS_NODE` in the shell turns Electron into headless Node

If the environment exports `ELECTRON_RUN_AS_NODE=1` (tooling does this to run Node scripts through an
Electron binary), any Electron you launch — including via `pnpm dev` — boots as **plain Node.js**: `app`,
`BrowserWindow`, the whole GUI API is `undefined`, and main throws on the first `app.*` call before a
window exists. It looks like a black or instantly-gone window. We own the launch, so `pnpm dev`/`preview`
run through a tiny wrapper that deletes the variable before spawning electron-vite. When an Electron main
crashes on `app` being undefined, suspect this variable before the code.

### Lazy loading is why the 10k-file acceptance is not even close

"Opens a 10,000-file repo in <2s" sounds like it needs a fast tree walk. It needs the opposite: **don't
walk.** Opening lists only the root directory (~70ms on a real 10k fixture); a directory's children load
when it is expanded, and the flat visible-node list is windowed by the VirtualList. The full index walk
(content-hashing every file) is real work, but it runs _off first paint_ in the background because it feeds
M3, not the tree. Design the data flow so the expensive thing is never on the paint path, and the
perf budget is met by construction rather than by optimisation.

---

## M1 — Design system & application shell (2026-07-14)

### The lesson: jsdom cannot test what needs real layout, so don't pretend it can

Two of M1's most important components — the cmdk command palette and the VirtualList — do their
core job (filtering, windowing) only when there is **real layout**, which jsdom does not compute.
The honest response is to test each component at the level jsdom can actually observe, and verify
the layout-dependent behaviour in the real app:

- **cmdk palette:** jsdom renders the dialog and the input but registers zero items (it decides
  nothing matches, without measurements). So the unit tests pin what is reliable — the dialog
  opens from the store, it is a labelled modal — and the _grouping_ logic is extracted into a pure
  function (`groupCommands`) and tested directly, while the filter/select behaviour is verified by
  driving the running app (screenshot: ⌘K → grouped commands with shortcut hints).
- **VirtualList:** jsdom renders 0 rows (0 scroll height), so the test asserts the layout-
  independent fact — the scroll spacer is sized for all 10,000 items — and the windowing itself is
  an M2 perf-acceptance concern in the real app.

Do not "fix" these by faking `getBoundingClientRect`. A test that mocks the layout engine is
testing the mock. State the boundary and move the check to where the behaviour is real.

### Rehydrated persisted state is untrusted input (found by the M1 red-team)

The Zustand UI store persists to localStorage. localStorage **survives across app versions** and
**a compromised renderer can write it**, so what the store reads on launch is untrusted input every
time — the same category as an IPC payload, and it must be validated the same way. A stale
`activeView` (a view renamed in an upgrade) or a tampered value flowing into a total lookup like
`copy[activeView]` crashes the app on launch, which violates DB §1's "a corrupted local store
degrades, it does not crash." The store's `merge` is the trust boundary: every rehydrated value is
coerced against the current known-good set before it enters state. **Apply this to every persisted
store from now on** — the pattern generalises to M2's SQLite-backed settings.

### Toolchain facts worth keeping

- **`ElementRef` is deprecated in React 19** — use `ComponentRef<typeof X>` in the Radix wrappers.
  The strict lint caught every occurrence.
- **`react-resizable-panels` v4 is a different API** from v2/v3: `Group`/`Panel`/`Separator`,
  `orientation` (not `direction`), and `defaultLayout` + `onLayoutChanged` for persistence (no
  `autoSaveId`). The drag handle exposes state via the `data-separator` attribute.
- **Tailwind v4 arbitrary CSS-variable values use parentheses**, not brackets: `duration-(--var)`,
  not `duration-[--var]` (which was the M0-audit invalid-CSS bug's cousin). Brackets are for
  arbitrary literal values; parens are for variables.
- **Tailwind v4 scans only what it is told.** A consuming app must `@source` the `@fixora/ui`
  package source, or the primitives render unstyled in the app while looking fine in Ladle (which
  has its own `@source`). This is invisible until you actually mount a primitive in the app.
- **jsdom needs polyfills for Radix/cmdk:** `ResizeObserver`, `matchMedia`, and
  `Element.prototype.{has,set,release}PointerCapture` + `scrollIntoView`. They live in each test
  package's setup file. A test setup that uses DOM globals must be type-checked under a DOM-lib
  tsconfig (i.e. live under `src/`, not a node-scoped `tests/`).
- **A build-in-`beforeAll` test needs a generous hook timeout.** The preload-bundle and
  css-consistency tests shell out to a ~10s build; the default 10s vitest hook timeout flaked under
  parallel CI load until raised.

### Noted for later (real, not yet due)

- `ipcRenderer` has a default max-listeners of 10. M5's streaming may add many `subscribe()`s to one
  channel; batch or raise the ceiling then.
- Command keybindings run at document capture and `preventDefault` on a match. When Monaco arrives
  (M2), define precedence between our chords and the editor's, or they will fight over ⌘K-shaped
  bindings.

---

## M0 red-team review — the adversarial pass (2026-07-14)

Reviewed as a competitor trying to break the architecture. The reusable lesson:

**The most dangerous bug was in a security control that already had tests and a comment claiming it
worked.** `isAppUrl` — the renderer's navigation containment boundary — returned `true` for _any_ `file:`
URL. It had a passing test suite. The test suite only checked `openExternal`, never `isAppUrl` itself, so
the guard's actual decision was unverified. This is the same shape as the audit's "gate on the input, not
the output": **a control is not tested until the test drives the control's own decision with hostile
input.** The fix came with a table of real attack URLs (`.ssh/id_rsa`, UNC-to-attacker-SMB, `..` escape),
and each was watched failing against the old code first.

Two things worth carrying forward:

- **`new URL('file:///…').origin === 'null'`** (the string). Any navigation guard that compares a file
  URL's origin is comparing against a useless constant. File-scheme navigation must be gated on the
  **resolved path** (inside a known directory, `..` and UNC handled), never on origin. This is why the
  production guard takes a `rendererRoot`, not an `appOrigin`.
- **A UNC file URL is an outbound network primitive.** `file://host/path` on Windows reaches out to
  `host` over SMB and will volunteer NTLM credentials. "It's only a local file scheme" is false; treat a
  non-empty host on a `file:` URL as hostile and reject it before anything else.

**Supply-chain check, recorded because the answer is a feature not an absence:** only four runtime
dependencies ship (react, react-dom, zod, our own). The heavy tooling (electron-vite, eslint, the
scanners) is all dev-only and never reaches the binary. The distributed attack surface is small _by
construction_ — a direct consequence of local-first (ADR-004): we ship an editor and a bridge, not a
cloud client.

---

## M0 audit — what a second pass found (2026-07-13)

Twelve real issues in code that had already passed every gate. Recording _why they got through_, because
that is the reusable part.

### The pattern: gates that were blind, and comments that lied

**Three of the four worst findings were invisible to the gates precisely because the gates were looking
elsewhere.** This is the single most important lesson from M0:

- The contrast gate **proved** the badge label passes 4.5:1 — while the Tailwind variable that applies that
  colour pointed at a token that no longer existed. The gate checked the _palette_; nothing checked that the
  palette was _reachable_. A gate on the input is not a gate on the output.
- `border.default` carried the comment "Contrast-checked at 3:1". It was never checked, and it would have
  failed. **A comment asserting a gate exists is the most dangerous comment there is**, because the next
  engineer trusts it and stops looking.
- The `duration-[--var]` class compiled to invalid CSS and silently did nothing. Tailwind does not error on
  a bad arbitrary value; it emits it and moves on.

**The rule this yields, and it is now a review criterion:** when you claim a gate protects something, go
break the thing and watch the gate fail. Every fix in this audit was verified that way. A gate you have
never seen fail is a hypothesis.

### The security finding worth remembering

The preload — the one privileged script in a sandboxed renderer, executed before first paint on every
window — was shipping **the entire zod library (120 kB of a 121 kB bundle)** because it imported the barrel
to get a list of channel _names_. Nothing was wrong with the code; the import looked completely innocuous.

Two things fell out of fixing it:

1. **The preload never needed to validate anything.** The router revalidates on the privileged side, which
   is the only side whose validation an attacker cannot own. Validation in the preload was security theatre
   that cost 120 kB.
2. **The obvious enforcement did not work.** A dependency-cruiser rule forbidding `preload → zod` reported
   green — because depcruise cannot resolve workspace subpath exports and never saw the edge at all. It was
   a _blind_ gate, the exact failure mode already documented in `.dependency-cruiser.cjs`, and I nearly
   shipped it as protection. It is replaced by an ESLint rule (which resolves the specifier, and permits
   type-only barrel imports since those are erased) **plus a test that greps the shipped bundle** — because
   the built artifact is the one thing no resolver quirk can hide.

### Toolchain traps found during the audit

- **`no-restricted-imports` `patterns` use gitignore semantics**, so a group of `@fixora/shared-types` also
  matches `@fixora/shared-types/channels`, and a `!negation` does _not_ reliably exempt it. Use **`paths`**
  (exact specifier match) when you mean the barrel and not its subpaths. Both forms support
  `allowTypeImports`, which is what lets the preload keep its zero-cost type imports.
- **WCAG 1.4.11 does not require every border to hit 3:1.** It governs the visual information _required to
  identify_ a control. A filled, labelled input is identifiable without its resting border, which is why
  every mature system keeps resting borders below 3:1 — the first step in our ramp that clears 3:1 is
  already "heavy". So `border.strong` is the gated identifying boundary; `border.default` is deliberately
  not. Do not "fix" this by darkening the resting border.

---

## Standing interpretations of the blueprint

Decisions about _how to read_ the docs, made once so they are not re-litigated.

| Question                          | Resolution                                                                                   | Why                                                                                                                                                                                                                                                                                                                     |
| --------------------------------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Is this repo `fixora-desktop`?    | **Yes.** `C:\dev\Fixora` _is_ the `fixora-desktop` monorepo. The blueprint lives at `docs/`. | Roadmap M0 puts the ADR directory at `docs/adr/`, and `docs/` was already at the repo root. README's status line said M0 was "blocked only on the repo move + `git init`". `fixora-api` and `fixora-web` split out at M4/M10 per ADR-019.                                                                               |
| Where do the IPC contracts live?  | **`packages/shared-types`**, not `electron/main/ipc/contracts.ts`.                           | The docs put them in both places (Architecture §4.1 vs Repo §2/TDD §2). Only one is possible: the renderer must import the contract types, and the renderer may not import from `electron/`. TDD §2's dependency table settles it — the renderer imports `shared-types`. `main/ipc/router.ts` consumes them from there. |
| Where does `@fixora/tokens` live? | `packages/tokens` in this monorepo, published to npm for `fixora-web` to consume.            | ADR-019 calls it a published package; Repo §3 says Changesets versions the packages. This is the only place both are true.                                                                                                                                                                                              |

---

## M0 — Foundations (2026-07-13)

### Decisions taken that need ADRs — **awaiting your approval to append to the register**

I have deliberately **not** edited `docs/03-DECISION-REGISTER.md`. These are drafted and ready.

#### ADR-029 — electron-vite as the desktop build tool

**Decision.** `electron-vite` 5 over a hand-rolled Vite + tsc + electron-builder script chain, or Electron Forge + webpack.
**Why.** It is the only mainstream tool that models Electron's _three_ build targets (main / preload / renderer) as first-class, with the correct externalisation and HMR defaults for each. Rolling our own means owning three configs and the interop between them — work that buys nothing and breaks quietly.
**Alternatives.** _Electron Forge + webpack_ — heavier, slower, and webpack is a step backwards from Vite for the renderer. _Hand-rolled_ — we would rebuild electron-vite, worse.
**Trade-offs accepted.** It pins us to Vite 7 (electron-vite 5 does not peer Vite 8 yet). Contained: Vitest 4 supports Vite 7, so there is no split.

#### ADR-030 — Tokens are TypeScript, and the "Tailwind preset" is a Tailwind v4 `@theme` layer

**Decision.** Design tokens are authored as TypeScript in `packages/tokens/src`, and built to (a) `tokens.css` — semantic CSS custom properties for light and dark, (b) `theme.css` — a Tailwind v4 `@theme` layer, (c) typed JS exports.
**Why.** Roadmap M0 asks for "a Tailwind preset". **Tailwind v4 removed JS presets** — the theme _is_ CSS now. `theme.css` is the v4-shaped equivalent, and it is importable by both the desktop app and `fixora-web`, which is all ADR-019 actually requires.
Authoring in TypeScript rather than JSON (or Style Dictionary) is what lets the **contrast gate import the palette directly and typecheck it**. A token that is not a typed value is a token the gate cannot see.
**Trade-offs accepted.** A small hand-written build script instead of a token pipeline product. It is ~120 lines and it does exactly what we need.

#### ADR-031 — `docs/adr/` is generated from the decision register, and CI fails on drift

**Decision.** The 28 ADR records are **generated** from `docs/03-DECISION-REGISTER.md` by `tooling/scripts/sync-adrs.ts`. `pnpm gate:adr` fails the build if they disagree. The register stays canonical.
**Why.** M0 requires a numbered record per decision. Hand-copying 28 decisions creates **two sources of truth for one fact** — the exact disease ADR-015 rejects for application state, and the register would win the argument on day one and lose it by month three. Generation makes drift impossible instead of merely discouraged.
**Consequence.** Editing a file in `docs/adr/` does not change a decision — it breaks the build. That is the correct response to someone changing a decision by editing a copy of it.

---

### What the gates caught — the reason they exist

Each of these was found by a gate, not by review. This is the M0 argument in miniature.

| Gate                         | What it caught                                                                                                                                       | Significance                                                                                                                                                                                                          |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Contrast gate**            | 8 colour pairs below WCAG AA on the **first** run — including `#8b5cf6` (violet-500), the obvious accent, which gives a white label only **4.23:1**. | ADR-026 predicted exactly this ("violet at low luminance is hard to keep above 4.5:1 for text"). The gate priced it instead of an argument.                                                                           |
| **Contrast gate**            | No amber that still reads as amber can carry white text on a near-black canvas (`#f5a524` gives **2.04:1**).                                         | So `warn` carries a dark label, and each status colour owns its `onSolid`. A "one global onSolid" token would have been silently wrong.                                                                               |
| **pnpm strict node_modules** | `@doyensec/electronegativity` has a **phantom dependency** on `commander` — it imports it without declaring it, and survives on hoisting.            | This is _precisely_ the failure ADR-020 chose pnpm to prevent. Fixed with `packageExtensions`, not by weakening the linker — weakening it would also re-open the door for `core-*` to resolve `electron` by accident. |
| **Electronegativity**        | `auxclick` (middle-click) can open a window down a path that bypasses `setWindowOpenHandler`.                                                        | Now `disableBlinkFeatures: 'Auxclick'`. A scanner found a hole that a careful reading of our own security doc did not.                                                                                                |
| **Dependency audit**         | 6 high-severity `tar` advisories (path traversal, arbitrary write) reached via the security scanner itself.                                          | Pinned via `overrides`. We did **not** exclude devDependencies to make it green: Security §7 says the release pipeline _is_ production.                                                                               |
| **ESLint (strict)**          | `externalizeDepsPlugin` is deprecated in electron-vite 5.                                                                                            | Free upgrade to the supported API.                                                                                                                                                                                    |

### Traps found in the toolchain (do not re-learn these)

- **`pnpm ci` is a built-in pnpm command.** It deletes `node_modules` and reinstalls. Our gate suite is
  **`pnpm run ci`**. The roadmap's literal `pnpm ci` no longer means what it did when the doc was written.
- **A sandboxed preload must be CommonJS.** Electron has no ESM preload under `sandbox: true`. Since
  `sandbox: true` is mandatory (Security §2), `apps/desktop` deliberately has **no `"type": "module"`**,
  and main/preload build to CJS. The renderer is still ESM. Do not "modernise" this.
- **Our own packages must be bundled into main/preload, not externalised.** `externalizeDeps: true` made
  the CJS main `require()` an ESM-only workspace package, which fails at runtime. `BUNDLED` in
  `electron.vite.config.ts` holds the exclusions.
- **TypeScript 6.0.3, not 7.x.** `typescript-eslint@8` peers `typescript <6.1.0`. TS 7 would leave the
  lint gate running _without_ its type-aware rules — green, and meaningless. Revisit when
  typescript-eslint ships TS 7 support.
- **`dependency-cruiser` cannot resolve `./x.js` → `./x.ts`** (what `verbatimModuleSyntax` makes us write).
  Every rule in `.dependency-cruiser.cjs` is therefore written against a **package specifier**, which it
  resolves correctly. Relative-path rules and cycles are ESLint's job. **When M1 adds feature-slice
  boundary rules (TDD §8.1), they must go in ESLint, not dependency-cruiser** — or they will pass by
  never seeing the edge they forbid.
- **`ELECTRON_RUN_AS_NODE=1` is set inside VS Code's integrated terminal.** It makes the Electron binary
  behave as plain Node, so `require('electron')` returns a _path string_ and the app dies with
  `Cannot read properties of undefined (reading 'requestSingleInstanceLock')`. Not a bug in the app.
  Clear the variable before launching.

### The focus ring: a requirement in the design review that cannot be satisfied

Design Review §2.4 asks for a focus ring at "≥3:1 against **both** the element and the background". For a
single-colour ring this is **provably impossible** in the light theme: the ring must be ≥3:1 from a
near-white canvas (forcing it dark) _and_ ≥3:1 from a mid-dark violet button (forcing it light), and no
colour is both. The **2px offset** resolves it — with an offset the colour adjacent to the ring is the
surface, not the control. This is why `--fx-focus-ring-offset-width` is a **contract**, not a style choice,
and why the contrast gate checks ring-vs-surface. Remove the offset and the gate becomes a lie.
Reasoning is recorded in `packages/tokens/src/requirements.ts` next to the code it constrains.

### Incident: Prettier reformatted the blueprint

`prettier --write .` ran before `docs/` was in `.prettierignore`. It normalised markdown table padding and
emphasis markers across all 19 documents. Tables and emphasis have been **restored and verified byte-exact**
against the originals; the residual delta is blank lines Prettier inserts around code fences and lists.
No content was changed or lost. `docs/` is now permanently ignored. See PROJECT_STATUS Open Item 1.
**Lesson, generalised:** a formatter pointed at a repo root will reformat documents that are inputs, not
outputs. Ignore human-authored source-of-truth prose _before_ the first format run, not after.
