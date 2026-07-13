# Fixora — Testing Strategy

Fixora has **three** things to test, and only one of them is normal software.

1. **Deterministic code** — patch application, path guards, quota math. Normal. Test normally.
2. **Integration with the outside world** — linters, test runners, providers, Stripe, the OS.
3. **A non-deterministic system whose quality can regress with no compile error and no failing test** —
   the prompts, the context builder, the model.

Category 3 is what kills AI products. A conventional test pyramid is blind to it. So the pyramid has a
fourth layer bolted to its side, and that layer is the most important one we own.

---

## 1. The pyramid

| Layer             | Tool                                             | Scope                                                                                | Gate                                                  |
| ----------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------ | ----------------------------------------------------- |
| **Unit**          | Vitest / pytest                                  | `core-patch`, `core-analysis` model, budgeter, secret gate, entitlement + quota math | Every PR                                              |
| **Contract**      | zod + OpenAPI codegen diff + schemathesis        | IPC contracts; API↔client schema drift                                               | Every PR                                              |
| **Integration**   | Vitest + real fixtures / pytest + testcontainers | Analyzer adapters against real repos; API↔Postgres↔mocked providers                  | Every PR                                              |
| **E2E**           | Playwright (Electron)                            | open → analyze → propose → verify → apply → undo, on a real fixture repo             | Every PR                                              |
| **Golden corpus** | Custom scorer                                    | **AI quality**                                                                       | Every PR touching a prompt/context/model, and nightly |
| **Security**      | Electronegativity · gitleaks · Semgrep · audits  | Config drift, secret leaks, deps                                                     | Every PR                                              |
| **Performance**   | Custom harness                                   | The NFR budgets                                                                      | Nightly + pre-release                                 |
| **Accessibility** | axe-core in Playwright                           | Zero critical violations, full keyboard traversal                                    | Every PR                                              |

---

## 2. The safety-critical tests

These test the things that, if broken, destroy a user's work or their trust. They get written **first**, and
they are the ones I'd keep if I could only keep ten.

**Patch application (`core-patch`)** — the highest-consequence code we own. A bug here corrupts someone's
source file, and no amount of AI quality recovers from that.

- Undo restores **byte-identical** content — including CRLF files, files with no trailing newline, and files
  with mixed line endings. _(These three quietly corrupt in every naive implementation.)_
- A file modified on disk after the patch was generated produces `PATCH_CONFLICT`. **Never a force-apply.**
- A crash mid-apply (simulated) leaves the file either fully original or fully patched. **Never half.**
- Hunk-level staging applies exactly the selected hunks and nothing else.

**Path guard** — property-based, not example-based. Throw fuzzed paths at it: `..` sequences, symlinks,
NTFS junctions, UNC paths, `/workspace-evil` against a root of `/workspace`, unicode normalisation tricks.
Every one must be rejected. This is a security boundary; example tests are not enough.

**Secret gate** — an integration test that plants a live-shaped AWS key, a GitHub token, and a private key
in a fixture repo and asserts the request is **blocked**, on **every CI run**. If this test is ever skipped
or quarantined, the build fails. This is the control preventing the extinction-level risk (PRD §11).

**Local DB corruption** — a deliberately corrupted SQLite file must degrade to "history unavailable" and the
app must still launch. Tested, because the failure mode is "user cannot open the app" and that is worse than
any bug we would otherwise ship.

---

## 3. The golden corpus — the test that keeps the product honest

**The problem it solves.** The prompt, the context builder, and the model version are code. They can regress
silently: no compile error, no failing test, no exception. Every AI team discovers this around month four,
when someone asks "does it feel worse to you?" and nobody can answer. By then the regression is months old
and untraceable.

**The corpus.** Real broken files with known-correct fixes, across TS/JS, Python and Go. Each entry:

```
fixtures/corpus/<lang>/<case-id>/
  before/          the broken code, in a runnable project
  finding.json     the grounded finding we expect the analyzers to produce
  expected/        a known-good fix (for reference, not for string comparison)
  tests/           tests that FAIL on `before` and PASS on `expected`
```

**The scorer** — and here is the leverage:

```
score(case) = f(
  targetResolved,        ← from the verification engine
  newFindings.length,    ← from the verification engine
  testsPassed,           ← from the verification engine
  tokensSpent
)
```

**The verification engine, run in a loop, IS the eval harness.** The same code that earns the user's trust
in the product also protects the product's quality over time. We built it once and it pays twice. That is
not a coincidence — it fell out of ADR-003, and it is the strongest evidence that the architecture is right.

**We never string-compare against `expected/`.** There are many correct fixes. We score _behaviour_: did the
finding go away, did nothing else break, do the tests pass. Grading on textual similarity to one blessed
answer would punish the model for being creative and correct — which is exactly the behaviour we want.

**The gate.** CI fails if the aggregate score regresses beyond a threshold. **No prompt change merges on
vibes.** Nightly runs against the latest model versions, so a provider silently updating a model behind an
alias shows up as a red build, not as a support ticket three weeks later.

**LLM-as-judge?** Only as a _secondary_ signal for things we can't measure objectively (is the explanation
clear?). Our primary signal is objective and free. A team that uses LLM-as-judge as its _primary_ eval has
outsourced its quality bar to the same class of system it is trying to grade.

---

## 4. What we deliberately do not test

- **We do not chase a coverage number.** Coverage is a smoke detector, not a fire alarm. 100% coverage of
  getters proves nothing. `core-patch` should be near-total; a React component's JSX should not be.
- **We do not snapshot-test UI.** Snapshots of markup fail on every refactor, get blindly re-recorded, and
  test nothing. Test behaviour and accessibility instead.
- **We do not mock what we can run.** ESLint is fast; run the real one against a real fixture. A mocked
  analyzer tests our mock, and our mock is always subtly wrong in the same direction as our assumptions.

---

## 5. Performance budgets (from the PRD, with tests attached)

| Budget                         | Test                                                        |
| ------------------------------ | ----------------------------------------------------------- |
| Cold start < 2.0 s             | Harness, on a clean VM, in CI, per release                  |
| Open 10k-file repo < 2.0 s     | Perf harness against a large fixture repo                   |
| Single-file analysis < 300 ms  | Bench in `core-analysis`                                    |
| Time to first AI token < 1.5 s | Measured against the real gateway, staging, p99 not average |
| Idle memory < 400 MB           | Release checklist                                           |
| Installer < 120 MB             | **CI fails the build** if it exceeds                        |

**A budget without a test is a wish.** Electron apps rot to 400 MB and 6-second starts one merged PR at a
time, and nobody is ever responsible, because no single PR made it slow. The failing build is the only
mechanism that has ever worked.

---

## 6. Release checklist (manual, on a clean Windows 11 VM)

Automation cannot catch these, and every one of them is a first-impression killer.

- [ ] Fresh install — **no SmartScreen warning, no AV warning.**
- [ ] Upgrade over the previous version — settings and local history survive.
- [ ] **Rollback** to the previous version — the app still launches and reads its DB (one-version backward
      tolerance, DB §1).
- [ ] Offline: local analysis works, signed out.
- [ ] Behind a corporate proxy: auth (deep link **and** loopback fallback) and SSE both work.
- [ ] Uninstall: removes cleanly, and **offers to delete local data rather than doing it silently.**
</content>

</invoke>
