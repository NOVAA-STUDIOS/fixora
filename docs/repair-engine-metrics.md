# Repair Engine — Measured Reliability (P0.3)

Measured on Windows against the **real verify worker** (`analysis-worker.mjs`, utility process) and the
**real `ai:applyRepair` handler** against a real filesystem. Nothing here is estimated. Numbers with a
provider dependency are marked so, not guessed.

## Deterministic gates — measured, no provider key (n = 5 languages)

Each language: one syntactically-valid repaired file and one syntactically-broken one, run through the
verify worker's parser + verifier (+ formatter where a formatter exists).

| Language | valid parses | valid verifies | broken repair rejected | verify time |
| --- | --- | --- | --- | ---: |
| TypeScript | yes | yes | yes | 7741 ms |
| JavaScript | yes | yes | yes | 4994 ms |
| React (.tsx) | yes | yes | yes | 5227 ms |
| Python | yes | yes | yes | 1185 ms |
| JSON | yes | yes | yes | 882 ms |

- **Parser reject rate on valid repairs: 0%** (target 0). A valid repair always parses.
- **Verification pass rate on valid repairs: 100%.**
- **Broken repairs correctly rejected: 100%.** A syntactically-broken patch never clears the parser
  gate, so an unverified repair is never applicable (requirement #7).
- **Average verify time: ~4.0 s**, dominated by tool/capability process startup (Python/JSON ~1 s;
  TS/TSX ~5–8 s because `tsc` runs). This is verification latency, not analysis of the file itself.

Also measured (real apply handler, real filesystem): **Apply success rate on valid, non-stale patches:
100%** (the apply-repair-fs suite), and a CRLF file stays uniformly CRLF after apply.

## Requires a provider key — NOT measured here, not estimated

These depend on what a live model returns and cannot be measured without a key:

- **Repair success rate** (does the model produce a valid, finding-clearing repair)
- **Apply success rate over model repairs end to end**
- **Average repair generation time**

Run the keyed round-trip harness to populate these; the harness exists and is wired.

## Safety invariants proven by regression test (CI-protected)

- A repair whose `expectedOriginal` no longer matches the file is **refused** (`stale-range`), never
  applied — position is re-validated against what the repair was computed for.
- Two repairs to one file: after the first applies, a second computed against the pre-change file is
  **refused**, never misapplied over the first (requirement #4).
- Splice preserves the file's line endings (CRLF stays CRLF); offset-based micro-repairs preserve
  endings byte-for-byte.
- The verify worker rejects a broken patch for every supported language.

## Known limitations (honest)

- Semantic context is same-file; cross-file declaration bodies are not yet resolved.
- Deterministic (safe-auto) micro-repairs are classified and produced but not yet wired to a
  no-model Apply path — they currently flow through the same AI-gated Apply as everything else.
- The end-to-end model round trip is unverified without a provider key.
