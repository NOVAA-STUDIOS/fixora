# Fixora — Public Beta Release Checklist

The engineering for the tagged `v0.9.0-beta.1` release is complete, verified, and tagged. This is the
sequence from a green codebase to a live Public Beta. Items marked **[owner]** need your machine/accounts
and can't be done from the codebase.

**Since that tag**, substantial additional engineering has been built on branch `sprint-1/ui-stability`
and is **not yet part of any tagged release**: Proceed Mode (a second editing pipeline) and a four-part
reliability/validation sequence (H1→Q1→Q2→Q3, the latter formally frozen 2026-07-27). See
[PROJECT_STATUS.md](../PROJECT_STATUS.md) for the current, authoritative state of that work — this
checklist's "Engineering" section below reflects only what was true at the `v0.9.0-beta.1` tag and has
not been re-run against the newer branch.

## Engineering (done in-repo, as of the `v0.9.0-beta.1` tag)

- [x] Verified AI repair loop: analyze → BYOK AI → gate → verify (overlay) → diff → apply → history.
- [x] Secret gate (fails closed), path-guarded apply, stale-apply guard, keychain-encrypted key.
- [x] Offline Ed25519 licensing (BYOK free; Supporter/Pro).
- [x] Packaging config + WASM-worker vendoring (`docs/PACKAGING.md`).
- [x] Website + user/privacy/licensing/acceptance docs.
- [x] Acceptance + audit + red-team (`docs/BETA-ACCEPTANCE.md`), ADR-036/037/038.
- [x] `pnpm run ci` green; version tagged.
- [ ] Proceed Mode + the H1–Q3 reliability sequence are **not represented in this checklist yet** — they
      postdate it. Not marked done here; see `PROJECT_STATUS.md` / `docs/BUGLOG.md` for their actual
      status. Clean-machine acceptance below has not been re-run against this newer work.

## Provisioning **[owner]**

- [ ] **Signing key for licensing** — `node tooling/scripts/license-keygen.mjs`; embed the public key in
      `apps/desktop/electron/main/license/public-key.ts` (or `FIXORA_LICENSE_PUBLIC_KEY`); store the
      private key offline. Until this, every install is Free (honestly reported).
- [ ] **Stripe Payment Link** for the Supporter/Pro price; success page → "check your email for your key".
- [ ] **Fulfilment** — mint keys with `tooling/scripts/sign-license.mjs` (manual per sale, or a
      `checkout.session.completed` webhook/Zapier later).
- [ ] **Email capture** endpoint (Buttondown/Formspree/…).

## Build the installer **[owner build machine]**

- [ ] `pnpm --filter @fixora/desktop package:win` → `apps/desktop/release/Fixora-Setup-<version>.exe`.
      (Runs the `prepackage` vendoring automatically. `pnpm install` afterwards to restore the dev symlink.)
- [ ] Optional: an app icon at `apps/desktop/build/icon.ico` (else the default Electron icon is used).

## Clean-machine acceptance **[owner]** — the real release gate

On a fresh Windows machine/VM (never ran `pnpm dev`), from `docs/BETA-ACCEPTANCE.md §1.2`:

- [ ] Installer runs; app launches (no black screen).
- [ ] Open a real repo → Run analysis → real findings.
- [ ] Paste a real OpenRouter key → Repair a finding → **Verified** diff → Apply writes the file.
- [ ] Explain streams; Test returns a test; History persists across a restart.
- [ ] **Network check**: only provider traffic during a run — nothing to a Fixora server.
- [ ] **Secret-gate check**: a smuggled key in a file blocks the send, naming file + rule.

## Publish

- [ ] Fill `DOWNLOAD_URL`, `STRIPE_URL`, `FORM_ACTION`, `DOCS_URL`, `ISSUES_URL` in
      `website/index.html`; real addresses in `privacy.html` + `security.txt`.
- [ ] Upload the installer (e.g. a GitHub Release for the tag); point `DOWNLOAD_URL` at it.
- [ ] Capture `website/screenshots/problems.png` and `verified-repair.png` **against the sample
      project in `examples/`**. Never against a real repository — a screenshot of a private codebase
      is a source-code leak, and it is very hard to walk back once search engines have indexed it.
- [ ] **`pnpm gate:website` must pass.** It fails while any placeholder or referenced asset is
      unresolved, and it is the gate for this whole section. It is intentionally not in the
      per-commit CI job (it would fail every PR until launch config lands) — run it here, and add it
      to CI once it goes green.
- [ ] Deploy `website/` (Cloudflare/GitHub Pages) at `fixora.dev`.
- [ ] Announce. Collect the first beta users. 🎉

## Go / No-Go

**GO** for release *engineering* — the product is built, verified, audited, and tagged. Public launch is
**GO once the clean-machine acceptance passes** on the built installer (the only check that needs a real
key + a real GUI, which a CI-less sandbox can't perform). No known critical defect blocks release.
