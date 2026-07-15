import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Finding, Language } from '@fixora/shared-types';
import { afterEach, describe, expect, it } from 'vitest';

import type { AnalysisTarget } from '../analyzer.js';
import type { ToolRun } from '../process/run-tool.js';

import { createGoVetAnalyzer } from './go-vet.js';
import { createMypyAnalyzer } from './mypy.js';
import { createRuffAnalyzer } from './ruff.js';
import { createSemgrepAnalyzer } from './semgrep.js';
import type { AdapterDeps } from './support.js';
import { createTscAnalyzer } from './tsc.js';

/**
 * The external-tool adapters, unit-tested through their injectable seams: a fake `resolveTool` (so
 * the tool "exists") and a canned `runner` (so we control the exact output). This exercises each
 * adapter's real parsing + grounding without any of ruff/go/tsc/semgrep/mypy installed. Real
 * invocation is covered in the acceptance run against real repos.
 */

let cleanup: string[] = [];
afterEach(() => {
  for (const dir of cleanup) rmSync(dir, { recursive: true, force: true });
  cleanup = [];
});

function tempWorkspace(files: Record<string, string> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'fixora-adapters-'));
  cleanup.push(dir);
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
  return dir;
}

function stdout(text: string): AdapterDeps {
  return {
    resolveTool: () => ({ command: 'fake', args: [] }),
    runner: (): Promise<ToolRun> =>
      Promise.resolve({ stdout: text, stderr: '', code: 1, killed: false }),
  };
}
function stderr(text: string): AdapterDeps {
  return {
    resolveTool: () => ({ command: 'fake', args: [] }),
    runner: (): Promise<ToolRun> =>
      Promise.resolve({ stdout: '', stderr: text, code: 1, killed: false }),
  };
}

function target(language: Language, file: string, source: string, root: string): AnalysisTarget {
  return { language, file, absPath: join(root, file), source, workspaceRoot: root };
}

async function collect(iter: AsyncIterable<Finding>): Promise<Finding[]> {
  const out: Finding[] = [];
  for await (const f of iter) out.push(f);
  return out;
}
const signal = (): AbortSignal => new AbortController().signal;

describe('ruff adapter', () => {
  it('maps ruff JSON to findings with categories by code prefix', async () => {
    const root = tempWorkspace();
    const src = 'import os\n\ndef f():\n    x = 1\n';
    const json = JSON.stringify([
      {
        code: 'F401',
        message: '`os` imported but unused',
        location: { row: 1, column: 1 },
        end_location: { row: 1, column: 10 },
        fix: { applicability: 'safe' },
      },
      { code: 'S105', message: 'hardcoded password', location: { row: 4, column: 5 } },
    ]);
    const findings = await collect(
      createRuffAnalyzer(stdout(json)).analyze(target('python', 'a.py', src, root), signal()),
    );
    expect(findings).toHaveLength(2);
    expect(findings[0]).toMatchObject({
      source: 'ruff',
      ruleId: 'F401',
      category: 'correctness',
      fixable: true,
    });
    expect(findings[1]).toMatchObject({ ruleId: 'S105', category: 'security' });
  });
});

describe('go vet adapter', () => {
  it('parses -json output, keeps the target file, uses the analyzer name as the rule', async () => {
    const root = tempWorkspace();
    const src = 'package main\n\nfunc main() {\n\tprintln("x")\n}\n';
    const report = JSON.stringify({
      'example/pkg': {
        printf: [{ posn: `${join(root, 'main.go')}:4:2`, message: 'Printf format %d has arg' }],
      },
    });
    const findings = await collect(
      createGoVetAnalyzer(stderr(report)).analyze(target('go', 'main.go', src, root), signal()),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      source: 'go-vet',
      ruleId: 'printf',
      category: 'correctness',
    });
    expect(findings[0]?.location.startLine).toBe(4);
  });

  it('drops diagnostics that belong to another file in the package', async () => {
    const root = tempWorkspace();
    const report = JSON.stringify({
      pkg: { printf: [{ posn: `${join(root, 'other.go')}:2:1`, message: 'x' }] },
    });
    const findings = await collect(
      createGoVetAnalyzer(stderr(report)).analyze(
        target('go', 'main.go', 'package main\n', root),
        signal(),
      ),
    );
    expect(findings).toEqual([]);
  });
});

describe('tsc adapter', () => {
  it('parses diagnostic lines for the target file and skips other files', async () => {
    const root = tempWorkspace();
    const src = 'export const x: number = "no";\n';
    const out = [
      `src/a.ts(1,24): error TS2322: Type 'string' is not assignable to type 'number'.`,
      `src/other.ts(5,1): error TS2304: Cannot find name 'foo'.`,
    ].join('\n');
    const findings = await collect(
      createTscAnalyzer(stdout(out)).analyze(target('typescript', 'src/a.ts', src, root), signal()),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      source: 'tsc',
      ruleId: 'TS2322',
      severity: 'error',
      category: 'correctness',
    });
    expect(findings[0]?.location).toMatchObject({ startLine: 1, startCol: 24 });
  });
});

describe('mypy adapter', () => {
  it('parses text diagnostics, extracts the error code, and skips notes', async () => {
    const root = tempWorkspace();
    const src = 'def f(x: int) -> int:\n    return x + "1"\n';
    const out = [
      'app.py:2:12: error: Unsupported operand types for + ("int" and "str")  [operator]',
      'app.py:2:12: note: some elaboration',
    ].join('\n');
    const findings = await collect(
      createMypyAnalyzer(stdout(out)).analyze(target('python', 'app.py', src, root), signal()),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ source: 'mypy', ruleId: 'operator', severity: 'error' });
    expect(findings[0]?.message).not.toContain('[operator]');
  });
});

describe('semgrep adapter', () => {
  it('supports() requires both the tool and a workspace config', () => {
    const withConfig = tempWorkspace({ '.semgrep.yml': 'rules: []' });
    const noConfig = tempWorkspace();
    const a = createSemgrepAnalyzer();
    const caps = (root: string) => ({ root, tools: new Set(['semgrep']), versions: new Map() });
    expect(a.supports('python', caps(withConfig))).toBe(true);
    expect(a.supports('python', caps(noConfig))).toBe(false);
  });

  it('maps semgrep results with severity and security category', async () => {
    const root = tempWorkspace({ '.semgrep.yml': 'rules: []' });
    const src = 'import os\nos.system(cmd)\n';
    const json = JSON.stringify({
      results: [
        {
          check_id: 'python.lang.security.audit.dangerous-system-call',
          start: { line: 2, col: 1 },
          end: { line: 2, col: 15 },
          extra: {
            message: 'dangerous system call',
            severity: 'ERROR',
            metadata: { category: 'security' },
          },
        },
      ],
    });
    const findings = await collect(
      createSemgrepAnalyzer(stdout(json)).analyze(target('python', 'a.py', src, root), signal()),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      source: 'semgrep',
      severity: 'error',
      category: 'security',
    });
  });
});
