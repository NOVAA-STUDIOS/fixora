# Verification Matrix

Recorded 2026-07-20, commit at time of writing on `sprint-1/ui-stability`.

**Rule for this document: a row says Verified only if the thing was actually executed and observed on
this machine.** Anything reasoned about but not run says Untested. There are no inferred rows.

## Platforms

| Platform | Status | Basis |
| --- | --- | --- |
| Windows 10 Pro 19045 (x64) | **Verified** | Full workflow driven through the real Electron app via Playwright `_electron`; results below. |
| macOS | **Untested** | No macOS machine available in this environment. Nothing about macOS behaviour is claimed. |
| Linux | **Untested** | Not executed. Nothing claimed. |

Platform-specific code that is therefore unverified off Windows: the `EPERM` message in
`fs-errors.ts` is written for Windows semantics (lock/attribute/cloud-sync rather than true
permission denial). On macOS/Linux `EPERM` more often does mean permissions, so that message is
expected to read slightly wrong there. Deliberate, and noted rather than hidden.

## Workflow — Windows runtime proof

Driven end to end against `samples/broken-react` in an isolated test profile.

| Step | Result | Evidence |
| --- | --- | --- |
| 1. Open project | **Verified** | `workspace:open` returned workspace `broken-react`. |
| 2. Analyze | **Verified** | 1 finding produced. Cold start took **38s** on this sample (measured twice). |
| 3. Explain | **Partial** | Reached `ai:run`, returned authored `no_key` — "Add your provider key in Settings → AI." The pipeline is proven up to the key gate; **the provider round-trip is untested** (see below). |
| 4. Repair | **Partial** | Same: authored `no_key`, not a redacted router error. Provider round-trip untested. |
| 5. Copy | **Verified** | `system:copyToClipboard` wrote `FIXORA-WORKFLOW-COPY`; read back from the real Electron clipboard and compared. |
| 6. Apply | **Verified** | `ai:applyRepair` wrote 400 bytes through the guarded write path, stale-check included. File on disk verified byte-identical afterwards (the splice was intentionally an identity edit). |
| 7. Re-analyze | **Verified** | Re-ran and produced findings again after the write. |

### What is NOT proven

The provider round-trip — the request to OpenRouter, the model's response, JSON extraction, and the
resulting repair proposal — **has never been executed in this environment**, because no provider key
is available here. Steps 3 and 4 stop at an authored `no_key`. Any claim that repair "works
end to end" would be fabricated. It is unverified past the key gate, full stop.

## Filesystem error paths

Unit-tested in `apps/desktop/tests/fs-errors.test.ts` (17 tests, all passing) and, where marked,
exercised against the running app.

| Condition | Status | How |
| --- | --- | --- |
| `ENOENT` — missing file | **Verified (real + runtime)** | Real temp dir, and through the live app: "src/does-not-exist.ts no longer exists…" |
| `ENOENT` — missing directory | **Verified (real + runtime)** | Same, via `fs:listDir`. |
| Directory read as file | **Verified (real + runtime)** | "That path is a folder, not a file…" |
| Directory written over | **Verified (real)** | Refused with `is_a_directory`. |
| Read-only file | **Verified (real)** | `chmod 0444`, then write. Test accepts either an authored error or success — Windows may permit it — but never an unauthored throw. |
| Symlink write refused | **NOT EXERCISED** | Symlink creation requires privilege/Developer Mode; unavailable here. The test **reports this out loud** rather than passing silently. |
| Symlink read allowed | **NOT EXERCISED** | Same reason, same honest report. |
| `EBUSY` / `ETXTBSY` | **Synthetic only** | Errno translation tested; no real locked file produced. |
| `EPERM`, `EACCES` | **Synthetic only** | Translation tested; real conditions not produced. |
| `EMFILE`/`ENFILE`, `ENOSPC`, `EROFS`, `ELOOP` | **Synthetic only** | Not feasible to provoke for real in a unit test. |
| Unknown errno | **Verified (synthetic)** | Still authored, and retains the raw code for maintainers. |
| No absolute path in any message | **Verified** | Asserted against Windows drive letters, `/Users/`, `/home/`. |

## Model capabilities

Derived from the **live OpenRouter catalogue** at run time (`supported_parameters`), not a hardcoded
list. Measured against the catalogue: 264 of 338 models report `structured_outputs`; only 5 of 14
free models do.

| Task | Requirement | Status |
| --- | --- | --- |
| Analyze | None — deterministic engines, no model | **Supported on every model** |
| Explain | Free-form text | **Supported on any model** |
| Repair | Structured output | **Supported only on models reporting `structured_outputs`** |
| Generate tests | Structured output | **Supported only on models reporting `structured_outputs`** |

Capability resolution **fails closed**: a model whose capabilities cannot be determined is treated as
incapable rather than assumed capable. All three previous default models lacked `structured_outputs`
— that was the measured root cause of the repair blocker, and the defaults were replaced with five
models measured to support it.

### Unsupported

| Capability | Status |
| --- | --- |
| HTML / CSS / JSON analysis | **Unsupported** — no engine. Not estimated, not partially claimed. |
| Repair accuracy metrics | **Not measured** — requires a provider key. Reported as "Not Measured (Provider Required)", never as a number. |

## Test suite

`36 files, 305 tests, all passing.` Lint clean (`--max-warnings 0`), typecheck clean on both
`tsconfig.node.json` and `tsconfig.web.json`.
