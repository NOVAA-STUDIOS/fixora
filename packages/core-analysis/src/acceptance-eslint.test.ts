import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import type { Finding } from '@fixora/shared-types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createEslintAnalyzer } from './analyzers/eslint.js';
import { createAnalysisContext } from './context.js';
import { resolveNodeTool } from './tools/resolve.js';

/**
 * M3 acceptance (roadmap): "runs against a real repo and produces findings that match what the
 * repo's own CI produces." This is the TS/JS proof, run with the **real eslint subprocess** (not
 * canned output): a fixture workspace with its own flat config + a file with real violations, linted
 * by the monorepo's actual eslint through the adapter. The findings the adapter yields must be the
 * violations eslint itself reports — because it *is* eslint.
 *
 * (go vet / ruff / mypy / semgrep acceptance needs those toolchains installed; their adapters are
 * unit-tested against real-format output, and the same subprocess path is proven here with eslint.)
 */

// The monorepo root, where a real eslint is installed. packages/core-analysis/src -> up 3.
const REPO_ROOT = resolve(import.meta.dirname, '..', '..', '..');
const eslintTool = resolveNodeTool(REPO_ROOT, 'eslint');

let workspace: string;

beforeAll(() => {
  workspace = mkdtempSync(join(tmpdir(), 'fixora-accept-'));
  mkdirSync(join(workspace, 'src'), { recursive: true });
  // A CJS flat config with two core rules — no plugins needed, so it runs anywhere eslint does.
  writeFileSync(
    join(workspace, 'eslint.config.js'),
    "module.exports = [{ rules: { 'no-unused-vars': 'error', 'no-console': 'warn' } }];\n",
  );
  // Real violations: `unusedVar` is never used (error); `console.log` trips no-console (warn).
  writeFileSync(
    join(workspace, 'src', 'bad.js'),
    'function greet(name) {\n  const unusedVar = 42;\n  console.log(name);\n  return name;\n}\n',
  );
});

afterAll(() => {
  rmSync(workspace, { recursive: true, force: true });
});

function context() {
  return createAnalysisContext({
    root: workspace,
    capabilities: { root: workspace, tools: new Set(['eslint']), versions: new Map() },
    files: [
      { file: 'src/bad.js', absPath: join(workspace, 'src', 'bad.js'), language: 'javascript' },
    ],
  });
}

async function run(): Promise<Finding[]> {
  const analyzer = createEslintAnalyzer({ resolveTool: () => eslintTool });
  const out: Finding[] = [];
  for await (const f of analyzer.run(context(), new AbortController().signal)) out.push(f);
  return out;
}

describe.skipIf(eslintTool === null)('eslint live acceptance', () => {
  it('runs real eslint and yields exactly the violations eslint reports, grounded', async () => {
    const findings = await run();

    // eslint reports the unused local `unusedVar` (and, correctly, the unused function `greet`);
    // target the local by its message so the assertion is about the exact violation.
    const unused = findings.find(
      (f) => f.ruleId === 'no-unused-vars' && f.message.includes('unusedVar'),
    );
    const noConsole = findings.find((f) => f.ruleId === 'no-console');

    // The real violation, mapped to a grounded Finding on the right file/line.
    expect(unused).toBeDefined();
    expect(unused).toMatchObject({
      source: 'eslint',
      severity: 'error',
      category: 'correctness',
    });
    expect(unused?.location.file).toBe('src/bad.js');
    expect(unused?.location.startLine).toBe(2); // `const unusedVar = 42;`
    // Grounded in the enclosing function via tree-sitter.
    expect(unused?.evidence.enclosingSymbol?.name).toBe('greet');

    expect(noConsole).toBeDefined();
    expect(noConsole).toMatchObject({ source: 'eslint', severity: 'warning', category: 'style' });
    expect(noConsole?.location.startLine).toBe(3); // `console.log(name);`

    // Every finding has the stable id shape and full confidence (deterministic tool).
    for (const f of findings) {
      expect(f.id).toMatch(/^[0-9a-f]{32}$/);
      expect(f.confidence).toBe(1);
    }
  }, 30_000);
});
