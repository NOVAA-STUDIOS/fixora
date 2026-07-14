import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import importX from 'eslint-plugin-import-x';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * Import restrictions that implement architectural invariant I1
 * (System Architecture §7, TDD §2): the pure packages must never see Electron or React,
 * and the renderer must never see Electron or Node.
 *
 * These are duplicated in .dependency-cruiser.cjs on purpose. ESLint tells the author in
 * their editor; dependency-cruiser tells CI about transitive violations ESLint cannot see.
 */
const forbid = (paths) => ({
  'no-restricted-imports': ['error', { paths: [], patterns: paths }],
});

const NO_ELECTRON = {
  group: ['electron', 'electron/*'],
  message:
    'ADR-005 / invariant I1: packages/core-* and the renderer must never import electron. ' +
    'If you need a privileged capability, add an IPC channel in @fixora/shared-types instead.',
};

const NO_REACT = {
  group: ['react', 'react-dom', 'react/*', 'react-dom/*'],
  message:
    'Invariant I1: this package must stay framework-free so it can run in a CLI, a CI action ' +
    'and a test harness (Scalability §2.2).',
};

const NO_NODE = {
  group: ['node:*', 'fs', 'path', 'os', 'child_process', 'crypto'],
  message:
    'The renderer is sandboxed and treated as hostile (ADR-018). It has no Node APIs. ' +
    'Everything it needs arrives through the preload bridge.',
};

const NO_NODE_FS = {
  group: ['node:fs', 'node:fs/*', 'fs', 'fs/promises'],
  message:
    'TDD §2: core-ai is a pure transformation (context in, prompt out). It does not touch disk.',
};

const NO_CORE = {
  group: ['@fixora/core-*'],
  message:
    'TDD §2: the renderer does not import core-* directly. It talks to main over the typed IPC ' +
    'boundary, which is the only surface it is allowed to have.',
};

/**
 * The preload is the one privileged script in a sandboxed renderer, it runs before first paint
 * on every window, and it is the single most security-sensitive file we ship. It must not pull
 * a runtime dependency: it needs channel *names*, which live in the zod-free
 * `@fixora/shared-types/channels` entry point. Importing the barrel drags zod in and cost 120 kB
 * of a 121 kB preload before this rule existed.
 *
 * `allowTypeImports` is the crux: the preload may reference the barrel's *types* (erased at
 * compile time, zero runtime cost), but a value import — the thing that ships zod — is refused.
 * A bundle-content test (`tests/preload-bundle.test.ts`) is the backstop that checks the actual
 * shipped artifact, because ESLint cannot see a value that arrives transitively.
 */
const PRELOAD_BARREL_MESSAGE =
  'The preload imports channel names from @fixora/shared-types/channels (zod-free), not the ' +
  'barrel. Type-only imports from the barrel are fine; a value import ships zod into the bridge.';

// `paths` is an EXACT match on the specifier, so it restricts the bare barrel without touching
// the `/channels` subpath — which a glob pattern (gitignore semantics) would also catch.
const PRELOAD_NO_RUNTIME_PATHS = [
  { name: '@fixora/shared-types', allowTypeImports: true, message: PRELOAD_BARREL_MESSAGE },
];

const PRELOAD_NO_RUNTIME_PATTERNS = [
  {
    group: ['zod', 'zod/*'],
    message:
      'The preload must not bundle zod. Validation belongs to the router on the privileged side.',
  },
];

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/out/**',
      '**/node_modules/**',
      '**/.turbo/**',
      '**/coverage/**',
      'docs/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  importX.flatConfigs.recommended,
  importX.flatConfigs.typescript,

  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: process.cwd(),
      },
      globals: { ...globals.node },
    },
    settings: {
      'import-x/resolver': { typescript: true, node: true },
    },
    rules: {
      // Standards §1: no `any`, and no escape hatch that does not carry a reviewed reason.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',
      '@typescript-eslint/no-unsafe-argument': 'error',
      '@typescript-eslint/ban-ts-comment': [
        'error',
        { 'ts-expect-error': 'allow-with-description', 'ts-ignore': true },
      ],

      // Standards §3: `type` for data, `interface` for contracts something implements.
      '@typescript-eslint/consistent-type-definitions': 'off',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],

      // Standards §3: no default exports — they make renames silent and grep useless.
      'import-x/no-default-export': 'error',
      'import-x/no-cycle': ['error', { maxDepth: Infinity }],
      'import-x/order': [
        'error',
        {
          groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index'],
          alphabetize: { order: 'asc', caseInsensitive: true },
          'newlines-between': 'always',
        },
      ],

      // Standards §2: a deferred-work marker is a bug with a comment on it. Open an issue.
      'no-warning-comments': [
        'error',
        { terms: ['todo', 'fixme', 'xxx', 'hack'], location: 'anywhere' },
      ],

      eqeqeq: ['error', 'always'],
      'no-console': ['error', { allow: ['warn', 'error'] }],

      // The compiler owns this one. `noPropertyAccessFromIndexSignature` (Standards §1)
      // *requires* bracket access on an index signature, so a lint rule demanding dot access
      // would be a rule that fights tsc — and tsc wins, so the rule only wastes review time.
      '@typescript-eslint/dot-notation': 'off',

      // This rule says "prefer `!` over `as T`". `no-non-null-assertion` says "never `!`".
      // Both cannot hold. We keep the safety rule and drop the style rule: the correct answer
      // to "this might be undefined" is to narrow it, not to pick a terser way to assert it.
      '@typescript-eslint/non-nullable-type-assertion-style': 'off',
    },
  },

  // ---------------------------------------------------------------------------------------
  // Invariant I1 — the boundary rules. These are the reason the monorepo is worth having.
  // ---------------------------------------------------------------------------------------
  {
    files: ['packages/core-analysis/**', 'packages/core-patch/**'],
    rules: forbid([NO_ELECTRON, NO_REACT]),
  },
  {
    files: ['packages/core-ai/**'],
    rules: forbid([NO_ELECTRON, NO_REACT, NO_NODE_FS]),
  },
  {
    files: ['packages/tokens/src/**', 'packages/shared-types/src/**'],
    rules: forbid([NO_ELECTRON, NO_REACT]),
  },
  {
    files: ['packages/ui/**'],
    rules: forbid([NO_ELECTRON, { ...NO_CORE, group: ['@fixora/core-*'] }]),
  },
  {
    files: ['apps/desktop/src/**'],
    languageOptions: {
      globals: { ...globals.browser },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...forbid([NO_ELECTRON, NO_NODE, NO_CORE]),

      // Standards §3: logic goes in hooks; derived state is derived during render.
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
    },
  },
  {
    files: ['apps/desktop/electron/main/**', 'apps/desktop/electron/preload/**'],
    rules: forbid([NO_REACT]),
  },
  {
    files: ['apps/desktop/electron/preload/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        { paths: PRELOAD_NO_RUNTIME_PATHS, patterns: [NO_REACT, ...PRELOAD_NO_RUNTIME_PATTERNS] },
      ],
    },
  },

  // Plain JS/MJS (flat configs, gate runners) has no tsconfig and needs no type-aware rules.
  {
    files: ['**/*.js', '**/*.mjs', '**/*.cjs'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: {
      parserOptions: { projectService: false },
    },
  },

  // Config files and build scripts are tooling, not product code.
  {
    files: [
      '**/*.config.{ts,js,mjs,cjs}',
      '**/scripts/**',
      'tooling/**',
      '**/vitest.config.ts',
      '**/electron.vite.config.ts',
    ],
    rules: {
      'import-x/no-default-export': 'off',
      'no-console': 'off',
      '@typescript-eslint/no-unnecessary-condition': 'off',
      // ESLint plugins ship CJS default exports that the resolver reads as ambiguous. This is
      // a fact about the plugin ecosystem, not about our code.
      'import-x/no-named-as-default': 'off',
      'import-x/no-named-as-default-member': 'off',
    },
  },

  // Tests may import dev-only helpers, assert on `any`-shaped fixtures, and use empty noop
  // functions as stubs and spies. These are legitimate in test code and noise everywhere else.
  {
    files: ['**/*.test.ts', '**/*.test.tsx', '**/tests/**'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-empty-function': 'off',
      // `unbound-method` is a false-positive generator against mocks and spies — referencing
      // `mock.handle` to read its `.mock.calls` is exactly what a test does, and the object is a
      // vi.fn(), not a class instance with a meaningful `this`.
      '@typescript-eslint/unbound-method': 'off',
    },
  },

  // Test *setup* files polyfill browser globals jsdom lacks (ResizeObserver, matchMedia, pointer
  // capture). That is inherently unsafe global assignment — it is what a polyfill is. Scope the
  // unsafe-* relaxations to these files rather than to all tests, so real test code stays strict.
  {
    files: ['**/*setup*.ts', '**/test/setup.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unnecessary-type-assertion': 'off',
      // A polyfill guards globals that TypeScript's DOM lib says always exist but jsdom omits.
      // `globalThis.ResizeObserver ??= …` is "unnecessary" by the types and necessary at runtime.
      '@typescript-eslint/no-unnecessary-condition': 'off',
    },
  },

  prettier,
);
