# Fixora — Technical Design Document

The PRD says *what*. This says *how*. Type signatures below are **design artifacts**, not implementation —
they define contracts and boundaries, and they are the things I want argued with before M0.

---

## 1. The core abstraction

Everything in Fixora is this, and nothing in Fixora is more than this:

```
Intent ──► TaskProfile ──► Context ──► Reasoning ──► Proposal ──► Verification ──► Presentation
```

```ts
// packages/core-ai — the contract the whole product hangs from
interface TaskProfile {
  id: TaskId; // 'repair' | 'explain' | 'security' | 'test-gen' | ...
  contextStrategy: ContextStrategy; // what code + evidence to gather, and how to rank it
  systemPrompt: PromptTemplate;
  outputSchema: JSONSchema; // structured output; we never regex a markdown fence
  modelTier: 'triage' | 'standard' | 'frontier';
  tokenBudget: TokenBudget;
  verification: VerificationStrategy; // 'none' | 'static' | 'static+types' | 'full'
  renderer: RendererId; // which React surface presents the result
}
```

A new capability is a `TaskProfile` and a renderer. **If adding one requires touching the engine, the
IPC layer, or the API, the abstraction has failed** and we stop and fix it rather than special-casing
around it (ADR-001).

---

## 2. Module boundaries

| Package | Depends on | Must **never** import | Why |
|---|---|---|---|
| `core-analysis` | tree-sitter WASM, node:fs | `electron`, `react` | Must run in a CLI, a CI action, and a test harness |
| `core-ai` | provider SDKs, `core-analysis` types | `electron`, `react`, `node:fs` | Pure transformation: context in, prompt out, stream in, proposal out |
| `core-patch` | `diff` libs | `electron`, `react` | Pure diff algebra; the most safety-critical code we own |
| `shared-types` | zod | everything | The contract layer; must be depended on, never depend |
| `ui` | react, radix, `@fixora/tokens` | `electron`, `core-*` | Presentational only; a component that knows about a Finding is in the wrong package |
| `electron/main` | all of the above | `react` | Privileged; the only process with FS, network, keychain |
| `electron/renderer` | `ui`, `shared-types` | `electron`, `node:*`, `core-*` | **Treat as hostile** (it renders untrusted code) |

Enforced by ESLint `no-restricted-imports` + `depcruise`, blocking in CI. This table is not advice.

---

## 3. Desktop process model

### 3.1 Main process (Node, privileged)

Owns: window lifecycle, IPC router, SQLite, keychain, auto-updater, deep-link handling, all filesystem
access, all network access to our API.

**Single-instance lock is mandatory** — not for politeness, but because deep-link auth callbacks must be
forwarded to the already-running window, and because two processes writing one SQLite file is corruption.

### 3.2 Renderer (sandboxed)

```
sandbox: true · contextIsolation: true · nodeIntegration: false
webSecurity: true · allowRunningInsecureContent: false
CSP: default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; ... no unsafe-eval
```

Monaco is configured to run **without `unsafe-eval`**. CI asserts the CSP string contains no `unsafe-eval`
and no `unsafe-inline` in `script-src`. This is a hard gate — Monaco's default setup wants `unsafe-eval`
and it is a common, quiet capitulation. We don't make it.

### 3.3 Utility processes

`analysis` and `verify`. Isolated because they run hostile-shaped work: a 40 MB minified file, a
catastrophically backtracking Semgrep rule, or *the user's own test suite*. Each has:
a hard timeout, a cancellation token, a memory ceiling, backoff-restart on crash, and a health check.

**A crashed worker degrades one panel. It must never take down the editor with unsaved work in it.**

---

## 4. The IPC contract layer

One registry, one source of truth, validated **in both directions**.

```ts
// electron/main/ipc/contracts.ts — the entire renderer→main attack surface, enumerable in one file
export const contracts = {
  'workspace:open': { req: z.object({ path: z.string() }), res: WorkspaceSchema },
  'analysis:run': {
    req: z.object({ workspaceId: Id, files: z.array(z.string()).optional() }),
    res: z.void(),
    stream: FindingSchema,
  },
  'ai:repair': { req: z.object({ findingId: Id }), stream: RepairEventSchema },
  'patch:apply': {
    req: z.object({ patchId: Id, hunks: z.array(z.number()) }),
    res: ApplyResultSchema,
  },
  'patch:undo': { req: z.object({ checkpointId: Id }), res: z.void() },
  // ...
} as const;
```

The preload builds a frozen object from this registry. `ipcRenderer` never reaches the renderer.

**The companion rule that actually prevents the exploit:** every handler touching a path calls
`assertInsideWorkspace(path)`, which canonicalises, **resolves symlinks**, and then compares against the
open workspace root. Path traversal is the #1 realistic exploit against a tool that reads local files, and
"we validate the string" is not a defence — `..`, symlinks, junctions, and UNC paths all defeat it.

---

## 5. The analysis engine (`core-analysis`)

### 5.1 The unified Finding model

Everything downstream — the findings panel, the AI context, the verification comparison, the golden corpus
scorer — speaks this one type. Getting it right is worth an afternoon of argument.

```ts
interface Finding {
  id: FindingId; // stable across runs: hash(rule, file, symbol, normalized-snippet)
  source: 'eslint' | 'tsc' | 'ruff' | 'mypy' | 'go-vet' | 'semgrep' | 'complexity' | 'ai';
  ruleId: string; // 'no-unused-vars', 'python.lang.security.audit.exec-detected'
  severity: 'error' | 'warning' | 'info';
  category: 'correctness' | 'security' | 'performance' | 'maintainability' | 'style';
  location: { file: string; startLine: number; startCol: number; endLine: number; endCol: number };
  message: string;
  evidence: Evidence; // ← this is what makes the LLM grounded rather than guessing
  fixable: boolean; // does the underlying tool already have a deterministic autofix?
  confidence: number; // 1.0 for deterministic tools; < 1.0 only for source: 'ai'
}

interface Evidence {
  enclosingSymbol?: SymbolRef; // from tree-sitter
  snippet: string;
  relatedLocations: Location[]; // e.g. where the variable was assigned
  toolOutput: unknown; // raw, for debugging and for the golden corpus
}
```

**`Finding.id` must be stable across runs** — otherwise the verification comparison (did the fix resolve
*this* finding? did it introduce a *new* one?) is impossible, and so is the golden corpus. This is a
deceptively load-bearing detail: hash the rule, the file, the enclosing symbol, and a *normalised* snippet
— never the raw line number, which shifts the moment a patch is applied.

### 5.2 Analyzer adapters

```ts
interface Analyzer {
  id: string;
  supports(lang: Language, ws: WorkspaceCapabilities): boolean; // is this tool in THIS workspace?
  analyze(target: AnalysisTarget, signal: AbortSignal): AsyncIterable<Finding>;
}
```

Adapters use **the workspace's own tooling and the workspace's own config**. We bundle nothing (ADR-007).

**The consequence, which is a feature:** our findings match the user's CI. If we bundled our own ESLint at
our own version with our own rules, we would produce findings their CI disagrees with — and a tool that
argues with your CI is a tool you uninstall.

**When a tool is absent**, we degrade to tree-sitter-only analysis for that language and *say so*
("Install ESLint for deeper analysis") rather than silently being worse.

Analysis is **incremental**: on a file change, re-analyze that file and its dependents, not the workspace.
Cache keyed by `content_hash + tool_version + config_hash`.

---

## 6. The patch engine (`core-patch`)

This is the most safety-critical code in the product. A bug here destroys a user's work, and no amount of
AI quality recovers from that.

```ts
interface Patch {
  id: PatchId;
  findingId: FindingId;
  hunks: Hunk[];
  baseContentHash: string; // ← the file as it was when the model saw it
  rationale: string;
  confidence: number;
}

type ApplyResult =
  | { ok: true; checkpointId: CheckpointId }
  | { ok: false; code: 'PATCH_CONFLICT'; currentHash: string } // file changed under us
  | { ok: false; code: 'HUNK_REJECTED'; hunk: number };
```

**Application is transactional, in this order, with no shortcuts:**

1. Re-read the file, hash it, compare to `baseContentHash`. Mismatch ⇒ **`PATCH_CONFLICT`, re-propose.
   Never force-apply.**
2. Write a checkpoint (original content + metadata) to the checkpoint store.
3. Write to a temp file in the same directory, `fsync`, then **atomic rename** over the target.
   (Same directory matters: `rename` is only atomic within a filesystem.)
4. Record `applications` + `checkpoints` rows in SQLite.
5. Any failure at any step ⇒ restore from checkpoint, surface a typed error.

**Undo is one keystroke and must restore byte-identical content, including line endings and trailing
whitespace.** Tested on CRLF files, files without trailing newlines, and files with mixed endings —
the three things that quietly corrupt in every naive implementation.

---

## 7. The verification engine

```ts
interface VerificationReport {
  strategy: 'static' | 'static+types' | 'full'; // ← we report exactly what ran
  targetResolved: boolean; // did the finding we aimed at go away?
  newFindings: Finding[]; // ← non-empty ⇒ REGRESSION, not a fix
  checks: CheckResult[]; // per analyzer: passed/failed/skipped + why
  tests?: {
    framework: string;
    run: number;
    passed: number;
    failed: TestFailure[];
    durationMs: number;
  };
  verdict: 'verified' | 'regression' | 'unresolved' | 'inconclusive';
}
```

**The overlay filesystem.** Copy the workspace using **hardlinks** (copy-on-write; near-instant even on a
10k-file repo), apply the patch to the copy, run the checks there. The user's actual disk is never touched
during verification. Hardlinks mean we must break the link before writing to a file — which is exactly what
the "write temp + atomic rename" pattern already does. The two designs compose.

**Test selection.** Run *affected* tests only, using the framework's own filtering (`vitest related`,
`pytest --lf` plus import-graph selection, `go test ./pkg/...`). Running the full suite is a 10-minute
verification nobody waits for, which means nobody verifies, which kills the thesis.

**Test execution is the one place we run the user's code.** It is their code, on their machine, from their
repo — this is not a privilege escalation. But it is still: **opt-in per workspace**, working directory
jailed to the overlay, hard-timeboxed, killable, network-disabled where the platform allows, and never on
by default.

**`inconclusive` is a first-class verdict, not a failure.** A tool that says "I couldn't verify this, here's
why" is trustworthy. A tool that pretends is not.

---

## 8. Frontend design

### 8.1 Feature-sliced structure

Each `features/<slice>/` owns its components, hooks, store slice, and IPC calls, and exports a public API
through `index.ts`. Cross-slice imports go through `ui/`, `lib/`, or an explicit public export — **never
by reaching into another slice's internals.** This is what stops a 300-file app becoming a hairball, and
it is checked by `depcruise` in CI, because conventions that aren't enforced aren't conventions.

### 8.2 State — four owners, zero overlap (ADR-015)

| Owner | Owns |
|---|---|
| **TanStack Query** | Anything that came over a wire — AI results, entitlements, history queries |
| **Zustand** | Anything the user clicked — panel sizes, active tab, selection, palette |
| **Monaco models** | Text. Including the undo stack. |
| **SQLite** | Anything that must survive a restart |

**We do not mirror file contents into Zustand.** That is the classic Monaco integration bug: two sources of
truth, double writes, lost undo, cursor jumps. Any PR that does it is rejected.

### 8.3 Streaming UI

AI responses arrive as SSE and are reduced **incrementally** into a structured object. The rationale streams
as prose while the diff is still being generated; findings appear in the panel as they are produced, not in
a batch at the end.

**A spinner for 20 seconds is a product failure**, not a loading state. Every long operation shows partial
results or a specific, honest status ("running 14 affected tests…"), never a generic spinner.

### 8.4 The command registry

Not a component — a subsystem. Every action registers `{ id, title, keybinding, predicate, run }`. From that
one registry we derive the ⌘K palette, the menu bar, and all keyboard shortcuts. Adding a feature adds a
command; the palette and the shortcuts come free, and they cannot drift out of sync with the UI because
there is only one list.

---

## 9. Error handling

Errors are **values**, not exceptions. Exceptions are for bugs.

```ts
type FixoraError =
  | { code: 'WORKSPACE_NOT_FOUND'; path: string }
  | { code: 'PATH_OUTSIDE_WORKSPACE'; path: string } // security event — logged as such
  | { code: 'SECRET_DETECTED'; file: string; rule: string }
  | { code: 'QUOTA_EXCEEDED'; used: number; limit: number; resetsAt: string }
  | { code: 'PROVIDER_UNAVAILABLE'; provider: string; retryable: boolean }
  | { code: 'CONTEXT_OVERFLOW'; tokens: number; budget: number }
  | { code: 'PATCH_CONFLICT'; currentHash: string }
  | { code: 'VERIFICATION_TIMEOUT'; strategy: string }
  | { code: 'ANALYZER_MISSING'; tool: string; language: string };
```

**Every error surfaced to a human names the next step.** "Quota exceeded" is a dead end.
*"You've used your 2M monthly tokens. Upgrade, or add your own API key in Settings → AI."* is a product.
This is a code review criterion, not a copywriting nicety.

React error boundaries are **per feature slice** — a crash in the findings panel must not white-screen an
editor with unsaved work in it.

---

## 10. Performance design

| Concern | Design |
|---|---|
| 10k-file workspace | Virtualised tree (`@tanstack/virtual`); index in the worker; never hold all files in memory |
| Analysis latency | Incremental, content-hash cached, cancellable; parallel across files in the worker |
| Editor responsiveness | Monaco owns its own text; no React re-render on keystroke |
| Verification on a big repo | Hardlink CoW overlay, affected-tests only |
| Token cost | Symbol-aware slicing (never whole files), ranked context, hard budget, prompt caching |
| Cold start | Lazy-load Monaco language workers; defer the analysis worker spawn until a workspace opens |
| Memory | Findings paged out of the renderer; SQLite is the store, not the Zustand tree |

Every one of these has a number in the PRD's NFR table, and a test in the perf harness. **A budget without
a test is a wish.**
</content>
</invoke>
