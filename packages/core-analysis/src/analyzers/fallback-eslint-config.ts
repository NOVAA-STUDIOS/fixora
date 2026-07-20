import { mkdtempSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * The rule set Fixora brings to a workspace that has none.
 *
 * This only ever applies when the user has no ESLint of their own (tier 2). It is therefore not a
 * statement about how anyone *should* write code — it is the smallest set of rules that catch things
 * essentially nobody wants in their program. Every rule here flags a defect, not a preference:
 * nothing about quotes, semicolons, indentation, or import order appears, because a false positive on
 * taste is exactly what destroys trust in an analyzer the user never asked to run.
 *
 * `no-unused-vars` is the one judgement call, and it earns its place: it is how a typo'd identifier,
 * a dropped refactor, and a forgotten import all surface. It is set to `warn`, not `error`.
 *
 * The config is written to a temp file rather than passed inline because ESLint's flat config must be
 * a real module on disk. It lives outside the workspace so analyzing a folder never writes to it.
 */

/** Rules chosen so that a report is always a real defect. Comments say why each one is here. */
const FALLBACK_CONFIG = `
import reactHooks from '__REACT_HOOKS__';
import tseslint from '__TSESLINT__';

export default [
  // Typed-syntax parsing for .ts/.tsx. Without this, ESLint's default parser cannot read a type
  // annotation and every TypeScript file fails with a parse error rather than being analyzed.
  {
    files: ['**/*.{ts,mts,cts,tsx}'],
    languageOptions: { parser: tseslint.parser },
  },
  {
    files: ['**/*.{js,mjs,cjs,jsx,ts,mts,cts,tsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    linterOptions: { reportUnusedDisableDirectives: false },
    rules: {
      // Certain bugs: these are never intentional.
      'no-undef': 'off',              // needs env config to be accurate; off rather than noisy
      'no-unreachable': 'error',      // code after return/throw — always dead
      'no-dupe-keys': 'error',        // a silently discarded object property
      'no-dupe-args': 'error',
      'no-dupe-else-if': 'error',
      'no-duplicate-case': 'error',
      'no-func-assign': 'error',
      'no-import-assign': 'error',
      'no-obj-calls': 'error',
      'no-sparse-arrays': 'error',
      'no-unsafe-negation': 'error',
      'no-unsafe-finally': 'error',
      'use-isnan': 'error',           // x === NaN is always false
      'valid-typeof': 'error',        // typeof x === 'strng'
      'no-self-assign': 'error',
      'no-self-compare': 'error',
      'no-constant-condition': 'error',
      'no-cond-assign': 'error',      // if (x = 1) — nearly always a typo'd ===
      'no-fallthrough': 'error',
      'no-compare-neg-zero': 'error',
      'no-setter-return': 'error',
      'no-async-promise-executor': 'error',
      'require-atomic-updates': 'error',
      'no-await-in-loop': 'off',      // legitimate often enough; too noisy to assert
      'no-empty': ['error', { allowEmptyCatch: true }],

      // Very likely bugs.
      'no-unused-vars': ['warn', { args: 'none', varsIgnorePattern: '^_' }],
      'no-prototype-builtins': 'warn',
      'no-useless-escape': 'warn',
      'no-irregular-whitespace': 'warn',
    },
  },
  // React Hooks. The rules of hooks are not style: calling a hook conditionally, or leaving a
  // dependency out, produces a component that is wrong at runtime in ways that are very hard to see
  // by reading. exhaustive-deps is the one that catches a useEffect with no dependency array.
  {
    files: ['**/*.{jsx,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
];
`;

/**
 * Materialize the fallback config and return its path.
 *
 * Created fresh per run in the OS temp directory: the analyzed workspace is never written to, which
 * matters because the user did not ask us to put files in their project.
 */
export function writeFallbackEslintConfig(): string | null {
  // The config lives in a temp directory, which has no node_modules — so bare specifiers in it would
  // not resolve. Rewrite them to absolute file: URLs pointing at OUR copies, resolved from this
  // module. That is also what makes the plugins work once packaged, where they sit inside
  // app.asar.unpacked rather than anywhere ESLint would think to look.
  const require = createRequire(import.meta.url);
  let reactHooks: string;
  let tseslint: string;
  try {
    reactHooks = pathToFileURL(require.resolve('eslint-plugin-react-hooks')).href;
    tseslint = pathToFileURL(require.resolve('typescript-eslint')).href;
  } catch {
    // Missing plugins mean the fallback would produce parse errors instead of findings, which is
    // worse than not running: refuse rather than report noise as if it were analysis.
    return null;
  }

  const dir = mkdtempSync(join(tmpdir(), 'fixora-eslint-'));
  const file = join(dir, 'eslint.config.mjs');
  writeFileSync(
    file,
    FALLBACK_CONFIG.replace('__REACT_HOOKS__', reactHooks).replace('__TSESLINT__', tseslint),
  );
  return file;
}
