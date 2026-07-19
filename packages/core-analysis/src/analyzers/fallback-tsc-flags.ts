/**
 * The compiler settings Fixora brings to a workspace with no tsconfig of its own (tier 2).
 *
 * The temptation here is `--strict`, and it is the wrong call. `strict` implies `noImplicitAny`, and
 * on an ordinary untyped JavaScript folder that produces one error per unannotated parameter —
 * hundreds of diagnostics, none of which is a bug the user has. An analyzer that floods you on first
 * run is one you turn off, so the useful setting is the narrow one.
 *
 * What is enabled, and why each one is a real defect rather than a missing annotation:
 *
 *  - `strictNullChecks` — the whole family of "possibly undefined" bugs. Without it TypeScript cannot
 *    see a null dereference at all, so it is the flag that makes null/undefined misuse detectable.
 *  - `noUncheckedIndexedAccess` — makes `arr[i]` yield `T | undefined`, which is what turns an
 *    off-by-one loop bound into a compiler error instead of a runtime NaN. This is the flag that
 *    catches the benchmark's JS and TS samples.
 *  - `allowJs` + `checkJs` — so a plain JavaScript folder is analyzed at all. Without these, tsc
 *    silently has nothing to do.
 *  - `noImplicitAny: false` — explicitly OFF. This is the firehose valve, and it stays shut.
 *  - `noUnusedLocals` / `noUnusedParameters` — OFF: eslint's `no-unused-vars` already covers this,
 *    and reporting it twice from two tools is how one defect becomes two findings.
 *
 * Everything else tsc reports by default is already high-confidence: unreachable code, bad property
 * access, wrong argument counts, type incompatibilities, missing exports, misused promises. Those
 * need no flag — they need tsc to be running, which until now it was not.
 */
export const FALLBACK_TSC_FLAGS: readonly string[] = [
  '--noEmit',
  '--pretty',
  'false',
  '--strictNullChecks',
  '--noUncheckedIndexedAccess',
  '--allowJs',
  '--checkJs',
  // Off by name rather than by omission, so the intent survives someone reading this later.
  '--noImplicitAny',
  'false',
  '--noUnusedLocals',
  'false',
  '--noUnusedParameters',
  'false',
  // A workspace with no tsconfig also has no lib/target, and the defaults are ES5 — which reports
  // every modern built-in as a type error. Name a modern baseline so the findings are the user's
  // bugs rather than our configuration.
  '--target',
  'es2022',
  '--module',
  'esnext',
  '--moduleResolution',
  'bundler',
  // JSX must be understood or every .tsx file is a syntax error rather than an analyzed file.
  '--jsx',
  'react-jsx',
  // Third-party types are not our business here, and walking them is slow.
  '--skipLibCheck',
];
