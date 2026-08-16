import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Finding, Language } from '@fixora/shared-types';
import { afterEach, describe, expect, it } from 'vitest';

import type { Analyzer, AnalysisNotice } from '../analyzer.js';
import { createAnalysisContext } from '../context.js';
import type { ToolRun } from '../process/run-tool.js';

import { createEslintAnalyzer } from './eslint.js';
import { createGoVetAnalyzer } from './go-vet.js';
import { createMypyAnalyzer } from './mypy.js';
import { createRuffAnalyzer } from './ruff.js';
import { createSemgrepAnalyzer } from './semgrep.js';
import type { AdapterDeps } from './support.js';
import { createTscAnalyzer } from './tsc.js';

/**
 * The external-tool adapters, unit-tested through their injectable seams: a fake `resolveTool` and a
 * canned `runner` (so we control the exact output). Each adapter now runs the tool ONCE over the
 * workspace and distributes findings across files — these tests exercise that parsing + grounding
 * without any of ruff/go/tsc/semgrep/mypy installed. Real invocation is covered in acceptance.
 */

const ROOT = process.platform === 'win32' ? 'C:\\ws' : '/ws';
const abs = (rel: string): string => join(ROOT, rel);

let cleanup: string[] = [];
afterEach(() => {
  for (const dir of cleanup) rmSync(dir, { recursive: true, force: true });
  cleanup = [];
});

interface FileSpec {
  file: string;
  language: Language;
  source?: string;
}

function context(
  files: FileSpec[],
  tools: string[],
  root: string = ROOT,
  reportNotice?: (notice: AnalysisNotice) => void,
) {
  const sources = new Map(files.map((f) => [join(root, f.file), f.source ?? '']));
  return createAnalysisContext({
    root,
    capabilities: { root, tools: new Set(tools), versions: new Map<string, string>() },
    files: files.map((f) => ({ file: f.file, absPath: join(root, f.file), language: f.language })),
    readSource: (p) => sources.get(p) ?? '',
    ...(reportNotice !== undefined ? { reportNotice } : {}),
  });
}

function outRunner(stdout: string, stderr = ''): AdapterDeps {
  return {
    resolveTool: () => ({ command: 'fake', args: [] }),
    runner: (): Promise<ToolRun> =>
      Promise.resolve({ stdout, stderr, code: 1, killed: false, timedOut: false, timeoutMs: 30_000 }),
  };
}

/** A tool killed at its 30s timeout — the NOV7-01 regression case. */
function timedOutRunner(timeoutMs = 30_000): AdapterDeps {
  return {
    resolveTool: () => ({ command: 'fake', args: [] }),
    runner: (): Promise<ToolRun> =>
      Promise.resolve({ stdout: '', stderr: '', code: null, killed: true, timedOut: true, timeoutMs }),
  };
}

async function collect(analyzer: Analyzer, ctx: ReturnType<typeof context>): Promise<Finding[]> {
  const out: Finding[] = [];
  for await (const f of analyzer.run(ctx, new AbortController().signal)) out.push(f);
  return out;
}

describe('eslint adapter', () => {
  it('maps ESLint JSON (run once) to grounded findings per file', async () => {
    const src =
      'export function processOrder(id: string): number {\n  const total = 0;\n  return total;\n}\n';
    const json = JSON.stringify([
      {
        filePath: abs('src/order.ts'),
        messages: [
          {
            ruleId: 'no-unused-vars',
            severity: 2,
            message: "'total' is assigned a value but never used.",
            line: 2,
            column: 9,
            endLine: 2,
            endColumn: 14,
            fix: { range: [1, 2], text: '' },
          },
          { ruleId: 'semi', severity: 1, message: 'Missing semicolon.', line: 3, column: 15 },
        ],
      },
    ]);
    const ctx = context(
      [{ file: 'src/order.ts', language: 'typescript', source: src }],
      ['eslint'],
    );
    const findings = await collect(createEslintAnalyzer(outRunner(json)), ctx);
    expect(findings).toHaveLength(2);
    expect(findings[0]).toMatchObject({
      source: 'eslint',
      ruleId: 'no-unused-vars',
      severity: 'error',
      category: 'correctness',
      fixable: true,
    });
    expect(findings[0]?.location).toMatchObject({
      file: 'src/order.ts',
      startLine: 2,
      startCol: 9,
    });
    expect(findings[0]?.evidence.enclosingSymbol?.name).toBe('processOrder');
    expect(findings[1]).toMatchObject({ ruleId: 'semi', severity: 'warning', category: 'style' });
  });

  it('supports() only when eslint is present; drops null-rule messages', async () => {
    expect(
      createEslintAnalyzer().supports({
        root: ROOT,
        tools: new Set(['eslint']),
        versions: new Map(),
      }),
    ).toBe(true);
    expect(
      createEslintAnalyzer().supports({ root: ROOT, tools: new Set(), versions: new Map() }),
    ).toBe(false);
    const json = JSON.stringify([
      {
        filePath: abs('a.ts'),
        messages: [{ ruleId: null, severity: 2, message: 'Parsing error', line: 1, column: 1 }],
      },
    ]);
    const ctx = context([{ file: 'a.ts', language: 'typescript' }], ['eslint']);
    expect(await collect(createEslintAnalyzer(outRunner(json)), ctx)).toEqual([]);
  });
});

describe('ruff adapter', () => {
  it('maps ruff JSON with categories by code prefix', async () => {
    const json = JSON.stringify([
      {
        code: 'F401',
        message: '`os` imported but unused',
        filename: abs('a.py'),
        location: { row: 1, column: 1 },
        fix: {},
      },
      {
        code: 'S105',
        message: 'hardcoded password',
        filename: abs('a.py'),
        location: { row: 4, column: 5 },
      },
    ]);
    const ctx = context([{ file: 'a.py', language: 'python' }], ['ruff']);
    const findings = await collect(createRuffAnalyzer(outRunner(json)), ctx);
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

describe('tsc adapter', () => {
  it('parses project diagnostics and distributes them across files', async () => {
    const out = [
      `src/a.ts(1,24): error TS2322: Type 'string' is not assignable to type 'number'.`,
      `src/b.ts(5,1): error TS2304: Cannot find name 'foo'.`,
    ].join('\n');
    const ctx = context(
      [
        { file: 'src/a.ts', language: 'typescript' },
        { file: 'src/b.ts', language: 'typescript' },
      ],
      ['tsc'],
    );
    const findings = await collect(createTscAnalyzer(outRunner(out)), ctx);
    expect(findings).toHaveLength(2);
    expect(findings.map((f) => f.location.file).sort()).toEqual(['src/a.ts', 'src/b.ts']);
    expect(findings.find((f) => f.location.file === 'src/a.ts')).toMatchObject({
      ruleId: 'TS2322',
      severity: 'error',
    });
  });
});

describe('ruff adapter — severity honesty', () => {
  // Ruff has no severity of its own. A certain runtime failure must not read as a style nit, and a
  // style nit must not be inflated to an error. This pins both directions.
  const ruffJson = (code: string, message: string): string =>
    JSON.stringify([
      {
        code,
        message,
        filename: abs('main.py'),
        location: { row: 2, column: 1 },
        fix: null,
      },
    ]);

  it('raises a guaranteed runtime failure (F821 undefined name) to error', async () => {
    const ctx = context([{ file: 'main.py', language: 'python' }], ['ruff']);
    const findings = await collect(
      createRuffAnalyzer(outRunner(ruffJson('F821', 'Undefined name `nmae`'))),
      ctx,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ ruleId: 'F821', severity: 'error' });
  });

  it('leaves an ordinary lint (F401 unused import) as a warning — no over-escalation', async () => {
    const ctx = context([{ file: 'main.py', language: 'python' }], ['ruff']);
    const findings = await collect(
      createRuffAnalyzer(outRunner(ruffJson('F401', '`os` imported but unused'))),
      ctx,
    );
    expect(findings[0]).toMatchObject({ ruleId: 'F401', severity: 'warning' });
  });
});

describe('ruff adapter — autofix capture', () => {
  const src = 'import os\nimport sys\n\nprint(sys.argv)\n';
  const safeFix = JSON.stringify([
    {
      code: 'F401',
      message: '`os` imported but unused',
      filename: abs('main.py'),
      location: { row: 1, column: 1 },
      end_location: { row: 1, column: 10 },
      fix: {
        applicability: 'safe',
        edits: [{ content: '', location: { row: 1, column: 1 }, end_location: { row: 2, column: 1 } }],
      },
    },
  ]);

  it('captures a SAFE fix as an offset autofix (row/col converted against the source)', async () => {
    const ctx = context([{ file: 'main.py', language: 'python', source: src }], ['ruff']);
    const findings = await collect(createRuffAnalyzer(outRunner(safeFix)), ctx);
    expect(findings[0]?.autofix).toEqual({ source: 'ruff', edits: [{ range: [0, 10], text: '' }] });
    // Offsets [0,10) are exactly the `import os\n` line — applying removes it.
    expect(src.slice(0, 10)).toBe('import os\n');
  });

  it('does NOT capture an unsafe fix — those may change behaviour', async () => {
    const unsafe = safeFix.replace('"safe"', '"unsafe"');
    const ctx = context([{ file: 'main.py', language: 'python', source: src }], ['ruff']);
    const findings = await collect(createRuffAnalyzer(outRunner(unsafe)), ctx);
    expect(findings[0]?.fixable).toBe(true); // ruff still has a fix...
    expect(findings[0]?.autofix).toBeUndefined(); // ...but it is not offered as a deterministic one
  });
});

describe('go vet adapter', () => {
  it('parses -json output and uses the analyzer name as the rule', async () => {
    const report = JSON.stringify({
      'example/pkg': {
        printf: [{ posn: `${abs('main.go')}:4:2`, message: 'Printf format %d has arg' }],
      },
    });
    const ctx = context([{ file: 'main.go', language: 'go' }], ['go']);
    const findings = await collect(createGoVetAnalyzer(outRunner('', report)), ctx);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      source: 'go-vet',
      ruleId: 'printf',
      category: 'correctness',
    });
    expect(findings[0]?.location.startLine).toBe(4);
  });
});

describe('mypy adapter', () => {
  it('parses text diagnostics, extracts the error code, skips notes', async () => {
    const out = [
      `${abs('app.py')}:2:12: error: Unsupported operand types  [operator]`,
      `${abs('app.py')}:2:12: note: some elaboration`,
    ].join('\n');
    const ctx = context([{ file: 'app.py', language: 'python' }], ['mypy']);
    const findings = await collect(createMypyAnalyzer(outRunner(out)), ctx);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ source: 'mypy', ruleId: 'operator', severity: 'error' });
    expect(findings[0]?.message).not.toContain('[operator]');
  });
});

describe('semgrep adapter', () => {
  it('supports() requires the tool and a workspace config', () => {
    const withConfig = mkdtempSync(join(tmpdir(), 'fx-sg-'));
    cleanup.push(withConfig);
    writeFileSync(join(withConfig, '.semgrep.yml'), 'rules: []');
    const noConfig = mkdtempSync(join(tmpdir(), 'fx-sg2-'));
    cleanup.push(noConfig);
    expect(
      createSemgrepAnalyzer().supports({
        root: withConfig,
        tools: new Set(['semgrep']),
        versions: new Map(),
      }),
    ).toBe(true);
    expect(
      createSemgrepAnalyzer().supports({
        root: noConfig,
        tools: new Set(['semgrep']),
        versions: new Map(),
      }),
    ).toBe(false);
  });

  it('maps results with severity and security category', async () => {
    const root = mkdtempSync(join(tmpdir(), 'fx-sg3-'));
    cleanup.push(root);
    writeFileSync(join(root, '.semgrep.yml'), 'rules: []');
    const json = JSON.stringify({
      results: [
        {
          check_id: 'python.lang.security.audit.dangerous-system-call',
          path: join(root, 'a.py'),
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
    const ctx = context([{ file: 'a.py', language: 'python' }], ['semgrep'], root);
    const findings = await collect(createSemgrepAnalyzer(outRunner(json)), ctx);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      source: 'semgrep',
      severity: 'error',
      category: 'security',
    });
  });
});

describe('NOV7-01: a tool killed at its timeout is reported, not silently "zero findings"', () => {
  const analyzerFor = (tool: string): Analyzer => {
    switch (tool) {
      case 'eslint':
        return createEslintAnalyzer(timedOutRunner());
      case 'tsc':
        return createTscAnalyzer(timedOutRunner(180_000));
      case 'ruff':
        return createRuffAnalyzer(timedOutRunner());
      case 'mypy':
        return createMypyAnalyzer(timedOutRunner(180_000));
      case 'go':
        return createGoVetAnalyzer(timedOutRunner(180_000));
      case 'semgrep':
        return createSemgrepAnalyzer(timedOutRunner(180_000));
      default:
        throw new Error(`unexpected tool ${tool}`);
    }
  };

  const fileFor = (tool: string): { file: string; language: Language } => {
    switch (tool) {
      case 'eslint':
        return { file: 'src/a.ts', language: 'typescript' };
      case 'tsc':
        return { file: 'src/a.ts', language: 'typescript' };
      case 'ruff':
      case 'mypy':
      case 'semgrep':
        return { file: 'a.py', language: 'python' };
      case 'go':
        return { file: 'main.go', language: 'go' };
      default:
        throw new Error(`unexpected tool ${tool}`);
    }
  };

  it.each([
    ['eslint', 'eslint'],
    ['tsc', 'tsc'],
    ['ruff', 'ruff'],
    ['mypy', 'mypy'],
    ['go', 'go-vet'],
    ['semgrep', 'semgrep'],
  ])('%s: a timeout raises a structured notice and yields no findings', async (tool, analyzerId) => {
    const root = mkdtempSync(join(tmpdir(), 'fx-timeout-'));
    cleanup.push(root);
    if (tool === 'semgrep') writeFileSync(join(root, '.semgrep.yml'), 'rules: []');

    const notices: AnalysisNotice[] = [];
    const ctx = context([fileFor(tool)], [tool], root, (n) => notices.push(n));

    const findings = await collect(analyzerFor(tool), ctx);
    // The tool never finished, so there are genuinely no findings — but that must not be SILENT.
    expect(findings).toEqual([]);
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({
      analyzerId,
      tool: 'fake',
    });
    expect(typeof notices[0]?.timeoutMs).toBe('number');
    expect(notices[0]?.message).toMatch(/stopped at its/);
  });

  it('a user abort stays silent: no notice, no findings', async () => {
    // Cancellation is `killed: true, timedOut: false` — it must never raise the timeout warning.
    const aborted: AdapterDeps = {
      resolveTool: () => ({ command: 'fake', args: [] }),
      runner: (): Promise<ToolRun> =>
        Promise.resolve({ stdout: '', stderr: '', code: null, killed: true, timedOut: false, timeoutMs: 30_000 }),
    };
    const notices: AnalysisNotice[] = [];
    const ctx = context([{ file: 'src/a.ts', language: 'typescript' }], ['eslint'], ROOT, (n) =>
      notices.push(n),
    );
    const findings = await collect(createEslintAnalyzer(aborted), ctx);
    expect(findings).toEqual([]);
    expect(notices).toEqual([]);
  });
});
