/**
 * Architectural invariant I1 (System Architecture §7, Repo §2), enforced on the *transitive*
 * graph — which is the half ESLint cannot see. A package that imports a helper that imports
 * `electron` has broken the rule just as thoroughly as one that imports it directly.
 *
 * This is the rule the Repository doc predicts "will be quietly broken first, by someone who
 * just needs app.getPath() in an analyzer". That is precisely why it is machine-enforced.
 *
 * ---------------------------------------------------------------------------------------
 * A known blind spot, stated rather than discovered later.
 *
 * dependency-cruiser 18 cannot resolve `./thing.js` back to `./thing.ts`, which is what
 * `verbatimModuleSyntax` makes us write. So it does **not** see relative intra-package edges.
 * Every rule below is therefore written against a *package specifier* (`electron`, `react`,
 * `node:fs`, `zod`), which it resolves correctly — and those are exactly the invariants that
 * matter here.
 *
 * The relative-path half of the job belongs to ESLint, whose TypeScript resolver does follow
 * those edges: `import-x/no-cycle` owns cycles, and `no-restricted-imports` owns the
 * feature-slice rules that arrive in M1 (TDD §8.1).
 *
 * What we do NOT do is leave a rule here that silently passes because the tool cannot see the
 * edge it forbids. A gate that reports green because it is blind is worse than no gate, since
 * it also buys false confidence.
 * ---------------------------------------------------------------------------------------
 */
module.exports = {
  forbidden: [
    {
      name: 'core-no-electron',
      severity: 'error',
      comment:
        'packages/core-* must never import electron (ADR-005). Keeping the core framework-free ' +
        'is what makes fixora-cli, a GitHub Action, and any future shell migration cost weeks ' +
        'instead of quarters.',
      from: { path: '^packages/(core-analysis|core-ai|core-patch|shared-types|tokens)/' },
      to: { path: '^(node_modules/)?electron($|/)' },
    },
    {
      name: 'core-no-react',
      severity: 'error',
      comment: 'packages/core-* and shared-types must stay UI-framework-free (TDD §2).',
      from: { path: '^packages/(core-analysis|core-ai|core-patch|shared-types|tokens)/' },
      to: { path: '^(node_modules/)?react(-dom)?($|/)' },
    },
    {
      name: 'core-ai-no-fs',
      severity: 'error',
      comment:
        'core-ai is a pure transformation: context in, prompt out, stream in, proposal out. ' +
        'It does not touch disk (TDD §2).',
      from: { path: '^packages/core-ai/' },
      to: { path: '^(node:)?fs($|/)', dependencyTypes: ['core'] },
    },
    {
      name: 'shared-types-depends-on-nothing',
      severity: 'error',
      comment:
        'shared-types is the contract layer. It must be depended on, never depend (TDD §2). ' +
        'zod is the single permitted exception.',
      from: { path: '^packages/shared-types/src/' },
      to: {
        // pnpm resolves to the content-addressed store, so the match must be on the package
        // directory, not on a bare specifier: node_modules/.pnpm/zod@4.4.3/node_modules/zod/...
        pathNot: ['^packages/shared-types/', 'node_modules/zod/'],
        dependencyTypes: ['npm', 'npm-dev', 'npm-optional', 'npm-peer'],
      },
    },
    {
      name: 'renderer-no-electron',
      severity: 'error',
      comment:
        'Invariant I2: the renderer is sandboxed and holds no token, no key and no filesystem ' +
        'handle. Its only surface is the preload bridge (ADR-018).',
      from: { path: '^apps/desktop/src/' },
      to: { path: '^(node_modules/)?electron($|/)' },
    },
    {
      name: 'renderer-no-node-builtins',
      severity: 'error',
      comment: 'The renderer has no Node APIs. nodeIntegration is false and stays false.',
      from: { path: '^apps/desktop/src/' },
      to: { dependencyTypes: ['core'] },
    },
    {
      name: 'main-no-react',
      severity: 'error',
      comment: 'The main process is privileged and headless. React belongs in the renderer.',
      from: { path: '^apps/desktop/electron/' },
      to: { path: '^(node_modules/)?react(-dom)?($|/)' },
    },
    {
      name: 'no-circular',
      severity: 'error',
      comment:
        'Cycles across package boundaries. Cycles *within* a package are caught by ESLint ' +
        "import-x/no-cycle — see the note on this tool's blind spot below.",
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '(^|/)(dist|out|coverage|\\.turbo)/' },
    // Type-only imports still create a boundary violation in review terms — a core package
    // that imports `type { BrowserWindow }` has still learned about Electron.
    tsPreCompilationDeps: true,
    /**
     * `verbatimModuleSyntax` means our source imports `./scales.js` and means `./scales.ts`.
     * dependency-cruiser needs the TypeScript resolver to follow that, and it gets it from a
     * tsconfig. Without this, the import graph is full of holes and the boundary rules below
     * pass by simply never seeing the edge they were written to forbid — a gate that reports
     * green because it is blind.
     */
    tsConfig: { fileName: 'tsconfig.depcruise.json' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
      extensions: ['.js', '.jsx', '.ts', '.tsx', '.mts', '.cts'],
    },
    reporterOptions: { text: { highlightFocused: true } },
  },
};
