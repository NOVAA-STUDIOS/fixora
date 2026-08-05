# Releasing

Windows only for the beta. One command produces the installer and uploads it to GitHub Releases **as
a draft** — nothing reaches a user until you press Publish there.

```
pnpm --filter @fixora/desktop release
```

## GH_TOKEN — where to set it

`electron-builder` reads the token from the environment. It is never written to
`electron-builder.yml`, and must never be committed.

Create a **fine-grained personal access token** on the `NOVAA-STUDIOS/fixora` repository with
`Contents: Read and write` — that is the only permission a release upload needs. A classic token
needs `repo`.

**Local, one shell (preferred — the token disappears when the shell closes):**

```powershell
$env:GH_TOKEN = 'github_pat_…'
pnpm --filter @fixora/desktop release
```

```bash
GH_TOKEN=github_pat_… pnpm --filter @fixora/desktop release
```

**Local, persistent** — only if you accept it sitting in your user environment:

```powershell
setx GH_TOKEN "github_pat_…"    # new shells only; reopen the terminal
```

**CI (GitHub Actions):** use the job's built-in token rather than a PAT.

```yaml
- run: pnpm --filter @fixora/desktop release
  env:
    GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

Never put the token in `.env` — that file is git-ignored but still readable by anything running in
the project, and a release token can rewrite repository contents.

## What is produced

| Artifact | Path | Uploaded |
| --- | --- | --- |
| Installer | `apps/desktop/release/Fixora-Setup-<version>.exe` | yes |
| Block map | `…exe.blockmap` | yes — differential download metadata |
| Unpacked app | `apps/desktop/release/win-unpacked/` | no — a directory, kept for local inspection |

The version comes from `apps/desktop/package.json`. electron-builder creates or reuses a draft
release tagged `v<version>`; bump the version before re-releasing, or the upload lands on the
existing draft.

## Before you press Publish

The beta is **unsigned**. Read `signAndEditExecutable` in `electron-builder.yml` for the detail and
ADR-021 for the plan.

- Windows SmartScreen will warn on first run. That is expected for an unsigned installer and is the
  main reason releases stay drafts.
- `Fixora.exe` carries the correct icon (stamped by `scripts/stamp-exe.cjs`) but still reports
  `ProductName: Electron` in its Properties dialog. Cosmetic, and fixed by the same signing work.
- Install the draft artifact on a clean machine and confirm it launches before publishing. Nothing
  in the pipeline verifies the installed app.
