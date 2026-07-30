# Fixora — Release Readiness Checklist & Execution Roadmap

**Phase:** Release Readiness (post Beta Readiness Audit series).
**Precondition, confirmed:** the originally planned **Beta Readiness Audit series (A1–A10) is
complete** — Welcome Experience, File Explorer & Workspace, Analyzer, Problems Panel, Repair Engine,
Proceed Mode, Suggestion System, Settings & AI Configuration, Repair History Panel, and Licensing all
closed with **zero genuine beta blockers remaining**. See `PROJECT_STATUS.md`'s "Beta Readiness
Audits" section for the authoritative per-module record.

**What this document is:** a plan, not a log. It sequences the work between "the audited codebase on
`main`" and "a real person can download and trust Fixora." Nothing in this document has been executed
yet — per instruction, no code or config changes have been made to produce it. Where an item requires
a decision only the owner can make (a real Stripe link, a real signing key, a real domain), it is
marked **[owner]**, matching the convention already established in `docs/RELEASE-CHECKLIST.md`.

**Repository state this plan is grounded in** (verified directly, not assumed):
- Current branch: `main`. `v0.9.0-beta.1` and `sprint-1/ui-stability` are both ancestors of the
  current `main` tip — the substantial post-tag work (Proceed Mode, the H1→Q3 reliability sequence,
  Sprint F1/F2, and the entire A1–A10 audit series) is **already on `main`**, not on a separate
  unmerged branch. `docs/RELEASE-CHECKLIST.md`'s framing ("built on `sprint-1/ui-stability`, not yet
  part of any tagged release") is accurate about *tagging* but slightly stale about *branch topology*
  — worth a small correction when that document is next touched (see §5).
- `apps/desktop/package.json` version: `0.9.0-beta.1` (unchanged since the tag — every commit since
  then is unreleased and untagged).
- CI (`.github/workflows/ci.yml`) runs: format check, build, typecheck, lint, full test suite,
  architectural-boundaries gate, contrast gate, ADR-drift gate, Electronegativity, gitleaks, and
  `pnpm audit`. It does **not** currently run `gate:certification`, `gate:accuracy`, `gate:validation`,
  or `gate:website` — all four exist and are part of the local `pnpm run ci` script, but are not
  wired into the GitHub Actions workflow. This is a real gap, not a documentation error (confirmed by
  reading `ci.yml` directly) — flagged in §2.
- `examples/` (the sample project `docs/RELEASE-CHECKLIST.md` says screenshots must be captured
  against) **does not exist in the repository yet**. Flagged in §6.
- Known open, explicitly-accepted risks carried into this phase: **BUG-002** (unresolved,
  non-reproducible data-integrity incident, hardened via `verifyWrittenFile()`), **BUG-003**
  (`acceptance-scale.test.ts` parallel-load flake, test-infra only), **BUG-005** (`navigation-guard.ts`
  fire-and-forget `shell.openExternal`, deliberately deferred, low severity). Full detail in §10.

---

## Execution roadmap — sequencing and dependencies

This is the order to actually do the work in, not just a list. Later phases depend on earlier ones
being real, not nominally checked off.

```
Phase 0  Branch/tag hygiene ............ decide the next version number and cut point (§4)
Phase 1  Cross-module E2E verification .. prove the audited modules work TOGETHER, not just alone (§1)
Phase 2  Production hardening ........... close the CI-gate gap, re-run gate:certification etc. (§2)
Phase 3  Packaging ....................... build + clean-machine acceptance, Windows installer + portable (§3)
Phase 4  Licensing validation ........... real keypair, real Stripe link, real fulfilment dry run (§7)
Phase 5  Release documentation .......... refresh RELEASE-CHECKLIST/PACKAGING/LICENSING/USER-GUIDE (§5)
Phase 6  Website readiness .............. placeholders, screenshots, gate:website green (§6)
Phase 7  Distribution ................... GitHub Release, installer upload, download-link wiring (§8)
Phase 8  Public Beta launch checklist ... final go/no-go, announcement sequencing (§9)
Phase 9  Accepted-risk sign-off ......... explicit owner acknowledgement of §10's carried-forward risks
```

**Why this order:** Phase 1 (cross-module E2E) has to happen before Phase 3 (packaging) because a
packaged build is expensive to iterate on (owner build machine, clean VM) — better to find an
integration gap on `pnpm dev` first. Phase 4 (licensing) has to happen before Phase 7 (distribution)
because the website and installer both need a real Stripe link and a real embedded public key before
they're truly "done," not placeholder-done. Phase 9 is last because it's a decision, not a task — it
only makes sense once everything it would be signing off on already exists.

---

## 1. Cross-module end-to-end verification

The A1–A10 audits each proved one module was individually sound. None of them proved the *seams*
between modules — the paths a real user actually takes that cross two or more audited surfaces in
one sitting. This phase is specifically about those seams.

- [ ] **Full golden-path run, one sitting, one workspace:** open a real project → Analyzer produces
      findings (A3) → Problems Panel shows them correctly, count included (A4) → Repair a finding,
      get a Verified diff, Apply it (A5) → History records it (A9, confirm it shows as a genuine
      Repair entry, not conflated with anything) → Proceed an unrelated edit via natural-language
      instruction (A6) → confirm its History entry does NOT offer "Re-run repair" (the A9 fix) →
      open Settings, confirm the AI config, model picker, and License section all render correctly
      together on one page (A8) → send a Suggestion via "Email to Fixora" (A7) → confirm workspace
      switching mid-session doesn't lose any of the above state incorrectly (A2).
- [ ] **Cross-audit interaction check:** Proceed Mode (A6) writes through the exact same
      `ai:applyRepair` path Repair (A5) uses — confirm a Proceed-sourced Apply and a Repair-sourced
      Apply, done back-to-back on the same file, don't confuse each other's staleness/range checks.
- [ ] **BUG-002 recurrence watch, cross-module:** the `[Q3-DIAG]` diagnostic logging (gated on a
      `proceed-diag` filename substring) is shared infrastructure across Repair and Proceed's write
      paths. Confirm it's still active and still correctly scoped before any release build — this is
      the one open data-integrity risk's only detection mechanism.
- [ ] **Settings↔License↔AI interaction:** confirm activating/deactivating a license (A10) doesn't
      disturb the AI key/model config state sitting on the same page (A8) — they're independent
      stores by design, but this is exactly the kind of seam an isolated audit wouldn't catch.
- [ ] **History↔Suggestion System independence:** confirm the two "history-like" features (Repair
      History, Suggestion History) don't share state, storage, or UI incorrectly — they're
      independently built but visually similar enough to be worth a direct side-by-side check.
- [ ] **Full regression suite green on `main` immediately before packaging** (not a stale run from
      mid-audit) — `pnpm run ci` end to end, not just `pnpm test`.
- [ ] **Manual pass through `docs/MANUAL_TEST_PLAN.md` and `docs/B4-MANUAL-ACCEPTANCE.md`** if either
      predates the A1–A10 work — confirm their scenarios still match current behavior, update only
      what's stale (don't rewrite what still holds).

## 2. Production hardening

- [ ] **Close the CI-gate wiring gap** (confirmed above): `gate:certification`, `gate:accuracy`,
      `gate:validation`, and `gate:website` all exist and pass locally but are not part of
      `.github/workflows/ci.yml`. Decide, don't default: either wire them into CI now (if they're fast
      and stable enough) or explicitly document why they stay manual-only pre-launch (mirroring the
      existing, deliberate reasoning already written for `gate:website` in `RELEASE-CHECKLIST.md`:
      "intentionally not in the per-commit CI job... run it here, and add it to CI once it goes
      green").
- [ ] **Re-run `gate:certification` and `gate:accuracy`** fresh against current `main` — these are
      the Analyzer accuracy/benchmark gates from the M3/Q1 era; confirm they still reflect reality
      after Q1's four analyzer fixes and haven't drifted (mirrors the exact BUG-004 class of failure
      already caught once — stale `sourceHashes` fingerprints).
- [ ] **Re-run `pnpm audit --audit-level high`** immediately before cutting the release build, not
      relying on a CI run from days earlier — dependency advisories are time-sensitive.
- [ ] **Confirm `gate:secrets` (gitleaks) has been run against full history**, not just the working
      tree, immediately before any public release — a secret in an old, already-pushed commit is
      still a leaked secret once the repo (or its history) is public.
- [ ] **Re-confirm BUG-002's mitigation is still live and correctly scoped**: `verifyWrittenFile()` in
      `apps/desktop/electron/main/services/fs/fs-service.ts` reads every write back and refuses on a
      byte mismatch. This is the single most safety-critical piece of production hardening carried
      forward from the audit series — verify it hasn't regressed, ideally with a dedicated
      byte-mismatch-injection test if one doesn't already exist.
- [ ] **Confirm the electronegativity/Electron-config gate is green on the exact config that ships**
      (CSP, sandboxing, context isolation, `nodeIntegration: false`) — not just on `pnpm dev`'s config,
      which can differ subtly from the packaged build's.
- [ ] **Confirm no dev-only affordances leak into a production build**: devtools auto-open, verbose
      `[Q3-DIAG]`/`[proceed]` console logging gated correctly for a real user's machine (the BUG-002
      diagnostics are deliberately kept — confirm this is a considered decision for release, not an
      oversight; a real user's console shouldn't be flooded by design, and it currently is only when
      a `proceed-diag` filename substring is hit, which should never occur in real usage).
- [ ] **Confirm the secrets denylist and secret gate are exercised against the exact packaged binary**,
      not just the dev build — this is the trust claim the whole BYOK story rests on.

## 3. Packaging (Windows installer and portable build)

`docs/PACKAGING.md` already documents the hard part (the WASM-worker `asarUnpack` constraint and the
`prepackage.mjs` symlink-dereferencing step) accurately and in detail — this section is the checklist
for actually running it now that A1–A10 work is included, plus the portable-build gap that document
doesn't currently cover.

- [ ] **Installer build** (owner build machine): `pnpm --filter @fixora/desktop package:win` →
      `apps/desktop/release/Fixora-Setup-<version>.exe`. Confirm `prepackage.mjs` ran (dereferenced
      `node_modules/@fixora/core-analysis` from a symlink to a real copy) before electron-builder's
      asar pack step, per the documented constraint.
- [ ] **Portable/unpacked build**: `package:dir` produces a fast, unpacked build for iteration —
      confirm whether a **true portable distributable** (a single `.exe` or zip a user can run without
      installing, as distinct from the dev-convenience `package:dir` output) is actually in scope for
      this release. If yes, this needs its own `electron-builder.yml` target (e.g. `portable` under
      `win.target`) and its own clean-machine acceptance pass — currently nothing in `PACKAGING.md`
      or `electron-builder.yml` describes a portable target, so this is new work, not a re-verification.
- [ ] **Clean-machine acceptance — installer**, on a genuinely fresh Windows machine/VM that has never
      run `pnpm dev` (per `PACKAGING.md`'s own checklist, now re-run against the full A1–A10 surface,
      not just the M2/M3-era baseline it was written against):
  - [ ] Installer runs; app launches (no black screen).
  - [ ] Open a real repo → Analyzer produces real findings (the asarUnpack/WASM proof).
  - [ ] Settings → AI: paste a real OpenRouter key → Repair a finding → Verified diff → Apply writes
        the file.
  - [ ] Proceed an edit via natural-language instruction → Verified proposal → Accept.
  - [ ] History (A9) shows both the Repair and the Proceed entry correctly, and "Re-run repair" is
        correctly absent from the Proceed one.
  - [ ] Settings → License (A10): activate a real (or test) signed license → shows "Fixora Pro."
  - [ ] Suggestion System (A7): submit feedback, confirm "Email to Fixora" or the Gmail fallback
        actually opens something on this clean machine (this is exactly the class of bug
        BUG-F1-EMAIL-001 was — a clean machine with no configured mail client is the real test).
  - [ ] History survives an app restart.
  - [ ] App data lives under `%APPDATA%/Fixora` and nowhere else.
  - [ ] **Network check**: capture traffic during a full session — only provider (OpenRouter) traffic
        during a run, nothing to any Fixora-owned server, confirming the BYOK/no-backend claim holds
        in the actual packaged binary, not just in code review.
- [ ] **Clean-machine acceptance — portable build**, same checklist, if a portable target is added.
- [ ] **Restore the dev symlink** (`pnpm install`) after packaging, per `PACKAGING.md`'s existing note
      — don't let a build machine's dereferenced copy linger and silently diverge from source.
- [ ] **Decide on code signing for this release.** `PACKAGING.md` states the beta ships **unsigned**
      (ADR-021 defers Azure Trusted Signing to "the paid launch") with an honest SmartScreen warning
      on the website. Confirm this is still the intended posture for *this* release specifically —
      given a real Stripe/Pro tier is now being activated (§7), re-confirm "unsigned is still
      acceptable" hasn't quietly become "should be signed" without anyone deciding that on purpose.

## 4. Versioning strategy

- [ ] **Decide the next version number, deliberately, not by default.** Current tag is
      `v0.9.0-beta.1`; `apps/desktop/package.json` still reads `0.9.0-beta.1` despite everything
      since then (Proceed Mode, H1→Q3, Sprint F1/F2, A1–A10) being unreleased. Options, weighed
      honestly:
  - `v0.9.0-beta.2` — same beta cycle, communicates "still beta, meaningfully updated." Understates
    how much shipped (a second editing pipeline, an entitlement system, ten audits' worth of fixes).
  - `v0.10.0-beta.1` — signals a meaningful minor bump within beta. Probably the most honest option
    given Proceed Mode alone is a second major feature, not a patch.
  - `v1.0.0-beta.1` — signals "this is the intended shape of the product," reserving `v1.0.0` (no
    beta suffix) for the actual public-stable cut. Reasonable if Proceed Mode + Licensing are
    considered feature-complete for the beta's stated goals.
  - **Recommendation for this document's roadmap purposes only** (not a unilateral decision — this is
    exactly the kind of call to bring to the owner): `v0.10.0-beta.1`, on the reasoning that a second
    full editing pipeline and a real entitlement system are minor-version-worthy, while "beta" stays
    honest about the clean-machine acceptance gate not yet having been re-run.
- [ ] **Confirm `apps/desktop/package.json`, the root `package.json`, and any version string baked
      into the website/installer name are updated together** — a mismatch here (app says one version,
      installer filename says another, website says a third) is a real, avoidable trust problem for a
      product whose whole pitch is precision and correctness.
- [ ] **Tag the exact commit that passed the full clean-machine acceptance pass** (§3), not the commit
      where code merged — the tag should mean "this exact build was verified," not "this is roughly
      where we finished."
- [ ] **Decide the CHANGELOG cut point**: does `[Unreleased]` become `[0.10.0-beta.1] - 2026-07-29` (or
      whatever date the tag actually happens on) wholesale, or does it get curated/reorganized first?
      Given the current `[Unreleased]` section is long and audit-heavy (many entries are "closed, no
      fix required" audit records rather than user-facing changes), consider whether the *public*
      changelog (if one is surfaced on the website) should be a curated subset rather than the full
      engineering log.

## 5. Release documentation

- [ ] **Refresh `docs/RELEASE-CHECKLIST.md`** — it currently states its "Engineering" section
      "reflects only what was true at the `v0.9.0-beta.1` tag" and explicitly does not represent
      Proceed Mode, H1–Q3, or (implicitly, since it predates this whole phase) Sprint F1/F2 or
      A1–A10. This is the single most important documentation update in this phase — the existing
      checklist is honest about being stale, but stale it remains until this work happens.
- [ ] **Refresh `docs/PACKAGING.md`** if a portable target is added (§3), and re-confirm its
      clean-machine checklist against the current, full feature surface rather than the M2/M3-era one
      it was written against.
- [ ] **Refresh `docs/LICENSING.md`'s owner setup steps** once a real keypair and Stripe link exist
      (§7) — turn the "how to set this up" instructions into "this is set up, here's what's live."
- [ ] **Update `docs/USER-GUIDE.md`** to include Proceed Mode, the License/Settings surface, and the
      Suggestion System if these aren't already documented there (the A5 remediation already updated
      its verdict-badge section; confirm the rest of the guide is equally current).
- [ ] **Update `PROJECT_STATUS.md`'s top-level framing** once this phase starts executing — it
      currently describes the A1–A10 series as the most recent milestone; once release work begins,
      the "current, authoritative state" pointer should shift to this document.
- [ ] **Correct `docs/RELEASE-CHECKLIST.md`'s branch-topology framing** (noted in this document's
      header): `sprint-1/ui-stability` is an ancestor of `main`, not a still-separate unmerged branch
      — small fix, worth doing in the same pass as the rest of this section's refresh.
- [ ] **Decide what, if anything, from `docs/BETA-ACCEPTANCE.md`'s acceptance criteria needs
      re-running** given how much shipped since it was last exercised — either re-run it in full or
      explicitly scope this release's acceptance pass as superseding it (not both silently).

## 6. Website readiness

- [ ] **Resolve the three documented placeholders** in `website/index.html`: `DOWNLOAD_URL`,
      `STRIPE_URL`, `FORM_ACTION` — plus real addresses in `privacy.html` and
      `.well-known/security.txt`, exactly as `website/README.md` already specifies.
- [ ] **Create the `examples/` sample project** — confirmed via direct check that this directory
      **does not currently exist**, despite `RELEASE-CHECKLIST.md` explicitly requiring screenshots
      be captured "against the sample project in `examples/`... never against a real repository."
      This has to exist before screenshots can be taken safely.
- [ ] **Capture `website/screenshots/problems.png` and `verified-repair.png`** against that sample
      project once it exists — and only once it exists; the existing instruction to never screenshot
      a real/private codebase is a hard rule worth repeating here, not softening.
- [ ] **Update website copy for Proceed Mode and Licensing** — `website/README.md` states the copy
      "is written to match what the app actually does (verified repair, BYOK, secret gate,
      local-first, telemetry off by default)"; confirm it now also accurately describes Proceed Mode
      and the real Pro/Supporter entitlement (once live), not just the original Repair-only pitch.
- [ ] **Run `pnpm gate:website` and confirm it's green** — this is the existing, deliberate gate for
      this entire section (per `RELEASE-CHECKLIST.md`: "It fails while any placeholder or referenced
      asset is unresolved").
- [ ] **Deploy to the real domain** (`fixora.dev`, via Cloudflare Pages/GitHub Pages per
      `website/README.md`'s instructions) only after the gate is green, not before.
- [ ] **Confirm the download link on the website points at the exact tagged, clean-machine-verified
      build** (§4's tag) — not a build from an earlier or later commit.

## 7. Licensing validation

A10 confirmed the *code* is correct and safe. This phase is about making the *system* real —
generating actual keys and actually testing the purchase→fulfilment→activation loop end to end,
which by definition couldn't be tested until an owner does it (the private key must never exist in
CI or in this repository).

- [ ] **[owner] Generate the real Ed25519 signing keypair**: `node tooling/scripts/license-keygen.mjs`.
      Store the **private** key in a password manager immediately — per the script's and
      `docs/LICENSING.md`'s own warning, there is no recovery path and losing it means re-issuing
      every license ever sold.
- [ ] **[owner] Embed the real public key**: either `apps/desktop/electron/main/license/public-key.ts`
      (`EMBEDDED_PUBLIC_KEY_DER_B64`) or the `FIXORA_LICENSE_PUBLIC_KEY` env var for the build.
      Confirm which mechanism the actual release build uses, and that it's consistent across
      whatever CI/build pipeline produces the shipped installer.
- [ ] **[owner] Create the real Stripe Payment Link** for the Supporter/Pro one-time price, with its
      success page pointing at a real "check your email for your key" page.
- [ ] **[owner] Run a real fulfilment dry run**: make a real (or Stripe-test-mode) purchase, mint a
      license with `tooling/scripts/sign-license.mjs` exactly as a real sale would, and activate it
      in a packaged build — proving the full loop once, for real, rather than trusting the unit tests
      alone (which necessarily use a synthetic keypair, not the real one).
- [ ] **[owner] Decide the fulfilment process for launch**: fully manual (owner mints and emails each
      key), or a Zapier/Make step on `checkout.session.completed` — `docs/LICENSING.md` already
      describes both as valid options; this phase is where that choice gets made rather than deferred.
- [ ] **Confirm the activation UX (`LicenseSettings`, audited in A10) correctly shows "Fixora Pro"**
      with the real licensee's email once a real key is activated, end to end, on a packaged build —
      not just against the synthetic test fixtures in `license.test.ts`.
- [ ] **Re-confirm, deliberately, that BYOK-free vs Pro restrictions remain exactly "none"** for this
      release, matching A10's audit finding and `docs/LICENSING.md`'s own stated model ("Free —
      everything... Pro/Supporter — same features in the beta; recognition + locked-in benefits") —
      if this has changed since the audit, that's a new decision requiring its own review, not
      something to slip in silently during the release-prep pass.

## 8. Distribution (GitHub Releases / installer)

- [ ] **Create the GitHub Release** for the version tag decided in §4, with the installer (and
      portable build, if one exists) attached as release assets.
- [ ] **Write real release notes** — likely a curated version of the `[Unreleased]` CHANGELOG section
      (see §4's cut-point question), written for a user deciding whether to download, not for an
      engineer reviewing a diff.
- [ ] **Point the website's `DOWNLOAD_URL`** at the exact GitHub Release asset (§6), and confirm the
      link actually resolves before announcing anything.
- [ ] **Decide on update-checking for this release** — `docs/21-PACKAGING-AND-UPDATES.md` may already
      describe a strategy; confirm whether auto-update is in scope for this release or explicitly
      deferred (a stale, unreachable update-check endpoint is worse than no update mechanism at all).
- [ ] **Confirm the installer's SmartScreen-unsigned warning is explained on the download page**
      (per `PACKAGING.md`'s stated posture) so a real user isn't surprised or scared off by a Windows
      warning nobody prepared them for.

## 9. Public Beta launch checklist

The final go/no-go sequencing, gathering every phase above into one ordered list for launch day
itself.

- [ ] All of §1–§8 above are checked off, with real (not placeholder) values everywhere a placeholder
      previously existed.
- [ ] Clean-machine acceptance (§3) has passed on the **exact tagged build** being distributed (§4),
      not an earlier or later one.
- [ ] `pnpm run ci` is green on the exact tagged commit.
- [ ] The website (§6) is live at the real domain, `gate:website` green, no placeholders remaining.
- [ ] A real license purchase→fulfilment→activation loop (§7) has been proven at least once.
- [ ] §10's accepted risks have been explicitly reviewed and re-confirmed as still acceptable for
      *this* release, not just carried forward by default from the audit series.
- [ ] Announcement channels/copy ready (matches `RELEASE-CHECKLIST.md`'s existing "Announce. Collect
      the first beta users." step) — decide where (site, socials, communities) before, not during,
      launch.
- [ ] A rollback/response plan exists for the first 24–48 hours: who monitors for a BUG-002-shaped
      report (a corrupted file after Apply/Accept), and what the response is (the mitigation is
      already live — `verifyWrittenFile()` — but a human should be watching for the first real-world
      signal one way or the other).

## 10. Known accepted risks carried forward from the audit series

These are not new findings — they are the open, explicitly-accepted items from the A1–A10 audits and
`docs/BUGLOG.md`, gathered in one place so launch is a *conscious* decision to ship with them, not a
silent one.

| Risk | Source | Current status | Why it's accepted |
|---|---|---|---|
| **BUG-002** — a file was reduced to 60 NUL bytes after a Proceed→Accept; root cause unresolved, non-reproducible after extensive investigation | H1/Q3 | Open — hardened via `verifyWrittenFile()` (every write is read back and refused on mismatch); `[Q3-DIAG]` diagnostics remain active for recurrence detection | No root cause found despite 8 controlled reproduction attempts; the safety net (never silently report a bad write as success) is real and tested; no further root-causing is possible without a live recurrence |
| **BUG-003** — `acceptance-scale.test.ts` times out under full-suite parallel load, passes in isolation | H1 | Open — tracked as test-infrastructure, not an application defect | Confirmed not to affect the shipped app; only affects local/CI test-run reliability |
| **BUG-005** — `navigation-guard.ts`'s `openExternal` is fire-and-forget (same shape as the fixed BUG-F1-EMAIL-001, for `https:` links rather than `mailto:`) | Suggestion System pass | Open — deliberately deferred | A default browser is present on virtually every real desktop, unlike a mail client; lower real-world impact than the bug it resembles |
| **A7 findings** — no mailto-URL length guard; no secret-scanning on suggestion text; Gmail fallback has no browser-presence pre-check; history/export capped at 500 rows | A7 | Deferred, non-blocking | None affect the user's actual project data; all are documented, low-frequency edge cases |
| **A8 findings** — decrypt failure reads as "never configured"; no client-side key-format validation; in-flight request not cancelled on key clear; credentials write non-atomic; `keychain_unavailable` path untested | A8 | Deferred, non-blocking | Core trust property (refuse-not-degrade-to-plaintext) verified correct; gaps are UX/coverage, not safety |
| **A9 findings** — no diff view in History despite promising one; Delete/Clear silently discard failures; 200-row cap, no pagination | A9 | Deferred, non-blocking | The one genuine blocker (misleading Proceed re-run error) is fixed; remaining gaps are feature-completeness, not correctness |
| **A10 findings** — no deactivate confirmation; file-write error path lacks its own `UserFacingError`; non-atomic license write; offline expiry vulnerable to clock skew; no revocation mechanism; no IPC/store/component test coverage | A10 | Deferred, non-blocking | Nothing is functionally gated on licensing in the beta, so even a worst-case exploit of these gaps has no entitlement-bypass consequence today |
| **CI gate-wiring gap** — `gate:certification`/`gate:accuracy`/`gate:validation`/`gate:website` are not part of the automated GitHub Actions workflow | This document, §2 | Open — newly surfaced, not previously tracked | Deliberate for `gate:website` (documented rationale already exists); the other three should get an explicit decision, not silent continuation, during Phase 2 |
| **No portable-build target exists yet** | This document, §3 | Open — newly surfaced | Only matters if a portable distributable is actually in scope for this release; needs an explicit yes/no, not an assumption |
| **`examples/` sample project doesn't exist** | This document, §6 | Open — newly surfaced | Blocks safe screenshot capture; small, well-scoped piece of new work |

**Sign-off required (Phase 9 of the roadmap):** before launch, the owner should explicitly re-confirm
each row above is still acceptable *for this specific release*, rather than treating "it was accepted
during an earlier audit" as a permanent, unreviewable status.

---

## Go / No-Go

**Not yet GO.** Per this document's own roadmap, no phase has been executed — this is the plan, not
the result. The engineering foundation is exceptionally strong (ten audits closed with zero
unresolved genuine blockers), which is exactly why this phase is about *packaging that strength into
a releasable product*, not about finding more defects. The path from here to a real public launch is
concrete, sequenced, and — per the roadmap above — mostly owner-gated (real keys, a real build
machine, real accounts) rather than further engineering risk.
