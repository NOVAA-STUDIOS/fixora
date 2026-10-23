# Windows releases

Production desktop releases are tag-driven. The `vMAJOR.MINOR.PATCH` Git tag is canonical; the
release preflight validates it and injects the matching version into `apps/desktop/package.json` on
the runner. The root package version is monorepo metadata, the web package has its own private app
version, and the VS Code extension retains its own package version. These values are not intended to
match.

## Version source of truth

At the `v1.2.25` baseline, the checked-in manifests read: root `1.0.0-beta.1`, desktop `1.2.24`,
and web `0.1.0`. The root version is not used as the desktop product version. For a tagged Windows
release, `.github/workflows/release.yml` calls
`apps/desktop/scripts/prepare-release.mjs`, which validates the tag and writes its version into the
desktop manifest on the CI runner before building. Electron's `app.getVersion()` and the packaged
desktop/updater metadata therefore use that injected desktop version. A local build uses the
checked-out desktop manifest value instead. The tag is canonical for the released desktop app.

The `v1.2.26` release is based on the `v1.2.25` public baseline. Its release contents are summarized
in the `1.2.26` changelog and release notes; older changelog entries remain historical.

## Required GitHub Actions configuration

Add these repository secrets (never commit or print their values):

- `AZURE_TENANT_ID`
- `AZURE_CLIENT_ID`
- `AZURE_CLIENT_SECRET`

Add these repository variables for the Trusted Signing account/profile and certificate identity:

- `AZURE_TRUSTED_SIGNING_ENDPOINT`
- `AZURE_TRUSTED_SIGNING_ACCOUNT`
- `AZURE_TRUSTED_SIGNING_PROFILE`
- `AZURE_TRUSTED_SIGNING_PUBLISHER` — exact publisher/certificate subject expected by electron-updater

The account and certificate profile must be authorized for the service principal represented by the
three Azure secrets. The release overlay uses electron-builder's Azure Trusted Signing support;
there is no local PFX, certificate path, or password in this repository. When all seven values are
present, the workflow signs and verifies the artifacts. Partial configuration always blocks the job.
For `v1.2.26` only, the deliberate absence of all signing values selects an explicitly unsigned build;
the workflow still validates artifacts, updater metadata, and hashes before publishing. Other
production tags remain fail-closed when signing configuration is absent.

## Tag release flow

Push a valid `vX.Y.Z` or semver prerelease tag. GitHub Actions validates signing mode and sets the
desktop package version from that tag, builds workspaces, clears stale artifacts, and packages with
publishing disabled. Signed mode uses `electron-builder.release.cjs` and requires SignTool verification
of `Fixora-Setup.exe` and `win-unpacked/Fixora.exe`, timestamp, and expected publisher. The v1.2.26
unsigned exception uses `package:win` and confirms both executables are unsigned. Both modes require
the expected installer, matching `latest.yml` version/path/URL and installer SHA-512. Only after all
gates pass does the workflow publish the non-draft GitHub Release. It uploads the installer, updater
metadata/blockmap, VSIX, and `SHA256SUMS.txt`.

The production signing config pins SHA-256 file digest, SHA-256 timestamp digest, and RFC3161
timestamp service `http://timestamp.acs.microsoft.com`. The installed electron-builder 25.1.8 Azure
integration forwards these options to `Invoke-TrustedSigning`. The actual certificate identity,
timestamp, and trust chain are validated by SignTool in the Windows runner.

`pnpm --filter @fixora/desktop package:win` is the unsigned local package path. The desktop `release`
script uses the signed overlay but does not publish; publishing is performed only by the validated
tag workflow. Do not manually publish unsigned artifacts.

## Local signature verification

On Windows with the SDK SignTool installed:

```powershell
signtool verify /pa /v .\apps\desktop\release\Fixora-Setup.exe
signtool verify /pa /v .\apps\desktop\release\win-unpacked\Fixora.exe
```

Inspect the verbose output for the expected signer and RFC3161 timestamp. Verify release checksums
with `Get-FileHash -Algorithm SHA256` against the basenames listed in `SHA256SUMS.txt`.

## Clean-machine release QA

- Installer signature reports the expected valid publisher and timestamp.
- Install and launch the application; observe and record SmartScreen behavior.
- Verify the installed `Fixora.exe` signature and launch the app.
- Verify auto-update discovery/download/install and that the updated executable remains signed.
- Verify uninstall and retained-user-data behavior.

## Current architecture note

The implemented updater and release workflow currently use GitHub Releases, despite accepted
ADR-022 specifying a future self-hosted staged-rollout feed. This change preserves the existing
GitHub updater behavior; implementing that ADR remains separate work. Real signing cannot be
verified locally without the credentialled Windows Actions environment.
