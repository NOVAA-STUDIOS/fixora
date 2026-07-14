# Changesets

This directory holds [changesets](https://github.com/changesets/changesets) — intent-to-release notes
for the versioned packages (`@fixora/tokens`, `@fixora/shared-types`), per Repo §3.

`@fixora/desktop` is **ignored**: its version is the release tag (Repo §3), not a changeset-managed
package version. Add a changeset when you change a published package's public surface:

```bash
pnpm changeset
```

The generated markdown becomes CHANGELOG entries and drives the version bump. Conventional Commits still
generate the app-level changelog; changesets version the packages.
