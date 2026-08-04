// Postpackage step: undo `prepackage.mjs`'s vendoring.
//
// `prepackage` replaces the `@fixora/core-analysis` SYMLINK with a dereferenced copy, because
// electron-builder's asar packer refuses to unpack a path whose realpath lives outside the app dir.
// That copy must not survive the packaging run.
//
// If it does, every subsequent `pnpm dev` / `electron out/main/index.js` loads the analysis engine
// from a frozen snapshot taken at package time, while `packages/core-analysis` moves on. Nothing
// reports it: the path exists, imports resolve, and `pnpm install` says "Already up to date" because
// pnpm only checks presence. The engine silently runs old code — a stale bundle path with no symptom
// except wrong results, which is the worst kind.
//
// Restoring the symlink here makes packaging leave the workspace exactly as it found it.
import { existsSync, lstatSync, readFileSync, rmSync, symlinkSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

const appDir = process.cwd(); // apps/desktop
const marker = join(appDir, 'node_modules', '.fixora-vendored-core-analysis');
const link = join(appDir, 'node_modules', '@fixora', 'core-analysis');

if (!existsSync(marker)) {
  console.log('postpackage: nothing was vendored — nothing to restore.');
  process.exit(0);
}

const target = readFileSync(marker, 'utf8').trim();
if (target === '' || !existsSync(target)) {
  console.error(
    `postpackage: recorded target "${target}" no longer exists. Leaving the vendored copy in place;\n` +
      '            run `rm -rf apps/desktop/node_modules && pnpm install` to restore the workspace.',
  );
  process.exit(1);
}

// Only replace a real directory — if it is already a symlink, prepackage did not run or was undone.
if (existsSync(link) && !lstatSync(link).isSymbolicLink()) {
  rmSync(link, { recursive: true, force: true });
}
if (!existsSync(link)) {
  // 'junction' works on Windows without elevation, which is the same reason the overlay uses it.
  symlinkSync(target, link, 'junction');
}
unlinkSync(marker);

console.log(`postpackage: restored @fixora/core-analysis -> ${target} (workspace link).`);
