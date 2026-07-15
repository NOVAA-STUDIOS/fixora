# Fixora — Project Memory

The things a new engineer (or a future me) would otherwise have to rediscover the hard way.
**This is not a summary of the blueprint.** The blueprint is in [docs/](./docs/) and it is the source of
truth. This file records what we _learned by building_, and the decisions we made that the blueprint did
not anticipate.

Updated after every milestone. Newest milestone first.

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
