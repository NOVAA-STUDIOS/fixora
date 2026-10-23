# Fixora Packaging — Windows installer

The local `package:win` / `package:dir` scripts intentionally support unsigned development artifacts.
Tagged production releases sign with the Azure Trusted Signing overlay when all required values are
configured. The `v1.2.26` release is an explicit unsigned exception; partial signing configuration
and unsigned later production tags fail closed. The workflow validates artifacts and updater metadata
before publishing and attaches `SHA256SUMS.txt`. See [RELEASING.md](./RELEASING.md) for the
authoritative release process and required Actions configuration.

## Build

```
pnpm --filter @fixora/desktop package:win
```

This builds main/preload/renderer, prepares the analysis worker assets, and runs electron-builder with
publishing disabled. It produces `apps/desktop/release/Fixora-Setup.exe` using the checked-out desktop
package version. Use `package:dir` for an unpacked build while iterating. Neither local command is the
tagged release workflow.

## The one hard part: the WASM worker must be unpacked from the ASAR

electron-vite bundles our packages + zod + chokidar into the CJS main. It deliberately does **not** bundle
`@fixora/core-analysis` — it is ESM and loads tree-sitter grammars (`.wasm`) via `import.meta.url`, which
only resolves against **real files**, never a path inside `app.asar`. The analysis/verification worker
(`analysis-worker.mjs`) imports that engine and is forked by path.

So `electron-builder.yml` lists these under `asarUnpack`, which places them in `app.asar.unpacked/`:

- `out/main/analysis-worker.mjs`
- `node_modules/@fixora/core-analysis/**`
- `node_modules/tree-sitter-wasms/**` (the grammar `.wasm` files)
- `node_modules/web-tree-sitter/**` (the core `.wasm`)

This is the same constraint M2/M3 hit; packaging is where it is paid. If a packaged build launches but
analysis silently does nothing, the first suspect is an unpacked-path miss here.

### pnpm note — the vendoring prepackage step (important)

The repo uses `node-linker=isolated` (`.npmrc`) on purpose — hoisting is forbidden because a phantom
dependency would let `packages/core-*` silently resolve `electron` and break the boundary rules
(ADR-005/020). Under that linker, `node_modules/@fixora/core-analysis` is a **symlink to
`../../packages/core-analysis`** (outside the app dir), and electron-builder v25's asar packer **refuses
to `asarUnpack` a path whose realpath is outside the app root** — it errors with
`… must be under apps/desktop`. This was confirmed empirically: the build downloads Electron and reaches
the pack step, then fails there.

**The fix is `scripts/prepackage.mjs`**, which the `package:win` / `package:dir` scripts run automatically
before electron-builder. It replaces that symlink with a **dereferenced real copy** of the engine — just
`dist/`, `package.json`, and the nested `node_modules/{tree-sitter-wasms,web-tree-sitter}` (the `.wasm`
files) — so everything `asarUnpack` touches lives under the app. It is idempotent.

The `package:win`, `package:win:release`, and `package:dir` scripts run `postpackage.mjs`, which
restores the workspace symlink automatically. If packaging is interrupted before that cleanup, run
the postpackage script from `apps/desktop` (or restore dependencies deliberately) before development.
The vendored copy is a build artifact; do not commit `apps/desktop/node_modules`.

This step is exercised by packaging. Clean-machine GUI acceptance (below) remains a manual product QA
task; signature verification for tagged release artifacts is separately automated on the Windows
Actions runner.

## Clean-machine verification (the release gate)

A packaged Electron app that builds is not a packaged app that runs. Before release, on a **clean Windows
machine** (or a fresh VM — one that never ran `pnpm dev`), use the artifact from the verified tag
workflow and follow the signature/update checklist in [RELEASING.md](./RELEASING.md). For v1.2.26,
record the expected unsigned/SmartScreen warning:

1. Run the installer; the app launches to the workspace screen (no black screen — the M2/M3 GPU + dev-CSP
   fixes are for `pnpm dev`; confirm the packaged app is clean too).
2. Open a real repo → **Run analysis** → real findings appear. *(This is the asarUnpack proof — if the
   worker can't load its WASM, findings never arrive.)*
3. **Settings → AI**, paste an OpenRouter key → **Repair** a finding → a **verified** diff appears →
   **Apply** writes the file. *(Proves the whole loop + the verification worker in the packaged app.)*
4. **History** shows the repair and survives a restart.
5. Confirm the app's data lives under `%APPDATA%/Fixora` and nothing was written elsewhere.

Only after 1–4 pass on a clean machine is the installer release-ready.
