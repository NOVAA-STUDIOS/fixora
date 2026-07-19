// Prepackage step for electron-builder (Beta packaging).
//
// The problem: the analysis/verification worker is ESM and loads tree-sitter `.wasm` via
// import.meta.url, so `@fixora/core-analysis` + its WASM deps must be REAL files unpacked from the asar.
// Under pnpm's isolated linker, `node_modules/@fixora/core-analysis` is a SYMLINK to `../../packages/
// core-analysis` (outside the app dir), and electron-builder v25's asar packer refuses to asarUnpack a
// path whose realpath is outside the app root ("must be under apps/desktop").
//
// The fix: before packaging, replace that symlink with a dereferenced real copy — just the runtime files
// (dist, package.json) and the nested WASM deps — so everything asarUnpack touches lives under the app.
// Idempotent. Run `pnpm install` afterwards to restore the workspace symlink for development.
import { cpSync, existsSync, lstatSync, mkdirSync, realpathSync, rmSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';

const appDir = process.cwd(); // apps/desktop

// The application icon is a tracked build resource, not something generated here: `pnpm icon`
// rasterizes it and it is committed. Regenerating it on every package would put a flaky compositor
// capture on the release path for a file that changes about once a year. But if it is missing,
// electron-builder does not fail — it quietly substitutes the default Electron icon and ships a
// generically-branded installer, which is exactly the defect this check exists to prevent.
const icon = join(appDir, 'build', 'icon.png');
if (!existsSync(icon)) {
  console.error(
    `prepackage: ${icon} is missing — electron-builder would fall back to the default Electron icon.\n` +
      '           Run `pnpm --filter @fixora/desktop icon` to regenerate it.',
  );
  process.exit(1);
}

const link = join(appDir, 'node_modules', '@fixora', 'core-analysis');

if (!existsSync(link)) {
  console.error(
    'prepackage: node_modules/@fixora/core-analysis not found — run pnpm install first.',
  );
  process.exit(1);
}

if (!lstatSync(link).isSymbolicLink()) {
  console.log('prepackage: @fixora/core-analysis is already vendored (real dir). Nothing to do.');
  process.exit(0);
}

const real = realpathSync(link); // packages/core-analysis

// Keep only what the packaged worker needs; drop source/tests/turbo/maps to keep the asar lean.
const KEEP_OUT = ['.turbo', 'src', 'tsconfig.json', 'tsconfig.build.json', 'vitest.config.ts'];
function filter(source) {
  const rel = source.slice(real.length + 1);
  if (rel === '') return true;
  const top = rel.split(sep)[0];
  if (KEEP_OUT.includes(top)) return false;
  if (rel.endsWith('.map') || rel.endsWith('.tsbuildinfo')) return false;
  return true;
}

rmSync(link, { recursive: true, force: true }); // remove the symlink (not its target)
mkdirSync(dirname(link), { recursive: true });
cpSync(real, link, { recursive: true, dereference: true, filter });

console.log(
  `prepackage: vendored @fixora/core-analysis into ${link} (dereferenced, with WASM deps).`,
);
