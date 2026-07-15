import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Finding } from '@fixora/shared-types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { AnalysisTarget, WorkspaceCapabilities } from '../analyzer.js';
import type { ToolRun, ToolRunner } from '../process/run-tool.js';

import { createEslintAnalyzer } from './eslint.js';

/**
 * The adapter's job is normalisation: run the workspace's eslint, turn its JSON into `Finding`s. We
 * unit-test the normalisation with a canned runner (no real subprocess) against a workspace whose
 * `node_modules/eslint` is a stub, so tool *resolution* is exercised for real while the *output* is
 * controlled. Real eslint invocation is covered in the acceptance run.
 */

let workspace: string;

beforeAll(() => {
  workspace = mkdtempSync(join(tmpdir(), 'fixora-eslint-'));
  // A stub eslint install so resolveNodeTool() finds it. The bin is never executed — the runner is faked.
  const eslintDir = join(workspace, 'node_modules', 'eslint', 'bin');
  mkdirSync(eslintDir, { recursive: true });
  writeFileSync(
    join(workspace, 'node_modules', 'eslint', 'package.json'),
    JSON.stringify({ name: 'eslint', version: '9.0.0', bin: { eslint: 'bin/eslint.js' } }),
  );
  writeFileSync(join(eslintDir, 'eslint.js'), '// stub');
});
afterAll(() => {
  rmSync(workspace, { recursive: true, force: true });
});

const SOURCE = `export function processOrder(id: string): number {
  const total = 0;
  return total;
}
`;

function target(): AnalysisTarget {
  return {
    file: 'src/order.ts',
    absPath: join(workspace, 'src', 'order.ts'),
    language: 'typescript',
    source: SOURCE,
    workspaceRoot: workspace,
  };
}

/** A runner that returns canned ESLint JSON regardless of what it is asked to run. */
function cannedRunner(json: unknown): ToolRunner {
  return (): Promise<ToolRun> =>
    Promise.resolve({ stdout: JSON.stringify(json), stderr: '', code: 1, killed: false });
}

async function collect(analyzer: ReturnType<typeof createEslintAnalyzer>): Promise<Finding[]> {
  const out: Finding[] = [];
  for await (const f of analyzer.analyze(target(), new AbortController().signal)) out.push(f);
  return out;
}

const caps = (tools: string[]): WorkspaceCapabilities => ({
  root: workspace,
  tools: new Set(tools),
  versions: new Map(),
});

describe('createEslintAnalyzer.supports', () => {
  it('applies to TS/JS only when eslint is present', () => {
    const a = createEslintAnalyzer();
    expect(a.supports('typescript', caps(['eslint']))).toBe(true);
    expect(a.supports('javascript', caps(['eslint']))).toBe(true);
    expect(a.supports('typescript', caps([]))).toBe(false);
    expect(a.supports('python', caps(['eslint']))).toBe(false);
    expect(a.supports('go', caps(['eslint']))).toBe(false);
  });
});

describe('createEslintAnalyzer.analyze normalisation', () => {
  it('maps an ESLint error to a Finding with location, rule, fixability and enclosing symbol', async () => {
    const analyzer = createEslintAnalyzer(
      cannedRunner([
        {
          messages: [
            {
              ruleId: 'no-unused-vars',
              severity: 2,
              message: "'total' is assigned a value but never used.",
              line: 2,
              column: 9,
              endLine: 2,
              endColumn: 14,
              fix: { range: [10, 20], text: '' },
            },
          ],
        },
      ]),
    );
    const findings = await collect(analyzer);
    expect(findings).toHaveLength(1);
    const f = findings[0]!;
    expect(f.source).toBe('eslint');
    expect(f.ruleId).toBe('no-unused-vars');
    expect(f.severity).toBe('error');
    expect(f.category).toBe('correctness');
    expect(f.location).toEqual({
      file: 'src/order.ts',
      startLine: 2,
      startCol: 9,
      endLine: 2,
      endCol: 14,
    });
    expect(f.fixable).toBe(true);
    expect(f.confidence).toBe(1);
    // Line 2 is inside processOrder — the enclosing symbol grounds the finding.
    expect(f.evidence.enclosingSymbol?.name).toBe('processOrder');
    expect(f.id).toMatch(/^[0-9a-f]{32}$/);
  });

  it('treats a warning as style and a missing endColumn as the start', async () => {
    const analyzer = createEslintAnalyzer(
      cannedRunner([
        {
          messages: [
            { ruleId: 'semi', severity: 1, message: 'Missing semicolon.', line: 3, column: 15 },
          ],
        },
      ]),
    );
    const [f] = await collect(analyzer);
    expect(f?.severity).toBe('warning');
    expect(f?.category).toBe('style');
    expect(f?.fixable).toBe(false);
    expect(f?.location.endLine).toBe(3);
    expect(f?.location.endCol).toBe(15);
  });

  it('skips messages with a null ruleId (parse/config errors, not lint findings)', async () => {
    const analyzer = createEslintAnalyzer(
      cannedRunner([
        { messages: [{ ruleId: null, severity: 2, message: 'Parsing error', line: 1, column: 1 }] },
      ]),
    );
    expect(await collect(analyzer)).toEqual([]);
  });

  it('degrades to no findings on non-JSON output rather than throwing', async () => {
    const analyzer = createEslintAnalyzer(() =>
      Promise.resolve({ stdout: 'Cannot find config', stderr: '', code: 2, killed: false }),
    );
    await expect(collect(analyzer)).resolves.toEqual([]);
  });
});
