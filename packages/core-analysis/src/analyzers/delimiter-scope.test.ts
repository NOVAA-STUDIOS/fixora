import { join } from 'node:path';

import type { Language, SymbolRef } from '@fixora/shared-types';
import { describe, expect, it } from 'vitest';

import type { ImportRef, RepairScope } from '../analyzer.js';
import { createAnalysisContext } from '../context.js';
import { parse } from '../parser/tree-sitter.js';

import { createJsonAnalyzer } from './json.js';
import { createFileGrounder, type RawFinding } from './support.js';
import { createSyntaxAnalyzer } from './syntax.js';

/**
 * Root Cause A + B2, proven end to end against the REAL analyzers and the REAL grammars.
 *
 * A — Tier-B findings (CSS/HTML/JSON) carried no enclosing range, so the repair target collapsed to
 *     the single line the parser gave up on, which for an unbalanced delimiter is often a different,
 *     perfectly valid construct. The model was shown correct code and told it was broken.
 * B2 — for delimiter-class findings the target widens to the outermost enclosing construct, which is
 *     the one whose delimiter is missing. Every other class keeps the narrow scope, and that
 *     narrowness is a safety property — a wider range widens what a wrong patch can damage.
 */

const ROOT = process.platform === 'win32' ? 'C:\\ws' : '/ws';

function ctx(file: string, source: string, language: Language) {
  return createAnalysisContext({
    root: ROOT,
    capabilities: { root: ROOT, tools: new Set(), versions: new Map() },
    files: [{ file, absPath: join(ROOT, file), language }],
    readSource: () => source,
  });
}

async function analyze(
  analyzer: ReturnType<typeof createJsonAnalyzer>,
  file: string,
  src: string,
  lang: Language,
) {
  const out = [];
  for await (const f of analyzer.run(ctx(file, src, lang), new AbortController().signal))
    out.push(f);
  return out;
}

/** Exactly `ai-service.ts`'s target-resolution chain. */
function resolveTarget(finding: {
  evidence: { enclosingRange?: { startLine: number; endLine: number } | undefined };
  location: { startLine: number; endLine: number };
}) {
  const scope = finding.evidence.enclosingRange;
  return scope ?? { startLine: finding.location.startLine, endLine: finding.location.endLine };
}

function splice(content: string, startLine: number, endLine: number, replacement: string): string {
  const lines = content.split(/\r?\n/);
  return [
    ...lines.slice(0, Math.max(0, startLine - 1)),
    ...replacement.split(/\r?\n/),
    ...lines.slice(endLine),
  ].join('\n');
}

describe('Root Cause A — Tier-B findings now carry a repair scope', () => {
  it('CSS: the target contains the DEFECT, not the unrelated valid rule the parser stopped at', async () => {
    const src = '.card {\n  color: #333;\n  padding: 8px;\n\n.other { color: red; }\n';
    const [finding] = await analyze(createSyntaxAnalyzer('css'), 'a.css', src, 'css');
    expect(finding).toBeDefined();
    expect(finding!.evidence.enclosingRange).toBeDefined();
    const target = resolveTarget(finding!);
    // The defect is the unclosed `.card {` on line 1 — the target must reach it.
    expect(target.startLine).toBe(1);
    // A correct model reply for that target makes the file parse, which it previously could not.
    const patched = splice(
      src,
      target.startLine,
      target.endLine,
      '.card {\n  color: #333;\n  padding: 8px;\n}',
    );
    const tree = await parse('css', patched, 'a.css');
    try {
      expect(tree.root.hasError).toBe(false);
    } finally {
      tree.dispose();
    }
  });

  it('JSON: an unclosed brace reported past the end still resolves to the object', async () => {
    const src = '{\n  "a": 1,\n  "b": 2\n';
    const [finding] = await analyze(createJsonAnalyzer(), 'a.json', src, 'json');
    expect(finding!.evidence.enclosingRange).toBeDefined();
    const target = resolveTarget(finding!);
    const patched = splice(src, target.startLine, target.endLine, '{\n  "a": 1,\n  "b": 2\n}');
    const tree = await parse('json', patched, 'a.json');
    try {
      expect(tree.root.hasError).toBe(false);
    } finally {
      tree.dispose();
    }
  });

  it('HTML: findings carry an enclosing range too', async () => {
    const [finding] = await analyze(createSyntaxAnalyzer('html'), 'a.html', '<div\n', 'html');
    expect(finding!.evidence.enclosingRange).toBeDefined();
  });
});

describe('Root Cause B2 — widening applies to delimiter rules ONLY', () => {
  const SOURCE = ['function outer() {', '  const a = 1;', '  const b = 2;', '}', ''].join('\n');
  const SCOPES: RepairScope[] = [
    { startLine: 1, endLine: 4, level: 'function' },
    { startLine: 2, endLine: 2, level: 'statement' },
    { startLine: 3, endLine: 3, level: 'statement' },
  ];
  const SYMBOLS: SymbolRef[] = [];
  const IMPORTS: ImportRef[] = [];

  function ground(ruleId: string): { startLine: number; endLine: number } | undefined {
    const grounder = createFileGrounder('tsc', 'a.ts', SOURCE, SYMBOLS, SCOPES, IMPORTS);
    const raw: RawFinding = {
      ruleId,
      severity: 'error',
      category: 'correctness',
      message: 'x',
      startLine: 2,
      startCol: 3,
      fixable: false,
      toolOutput: null,
    };
    return grounder.ground(raw).evidence.enclosingRange;
  }

  it('a delimiter rule widens to the outermost construct — the one missing its brace', () => {
    expect(ground('TS1005')).toEqual({ startLine: 1, endLine: 4 });
    expect(ground('TS1128')).toEqual({ startLine: 1, endLine: 4 });
    expect(ground('E999')).toEqual({ startLine: 1, endLine: 4 });
  });

  it('a type error keeps the NARROW scope — widening it would enlarge the blast radius', () => {
    expect(ground('TS2322')).toEqual({ startLine: 2, endLine: 2 });
  });

  it('a lint rule keeps the narrow scope', () => {
    expect(ground('prefer-const')).toEqual({ startLine: 2, endLine: 2 });
    expect(ground('no-unused-vars')).toEqual({ startLine: 2, endLine: 2 });
  });

  it('an undefined-name rule keeps the narrow scope — it is fixed by symbol resolution, not widening', () => {
    expect(ground('TS2304')).toEqual({ startLine: 2, endLine: 2 });
    expect(ground('F821')).toEqual({ startLine: 2, endLine: 2 });
  });

  it('every non-delimiter rule resolves to exactly the same narrow scope as before the change', () => {
    const narrow = { startLine: 2, endLine: 2 };
    for (const rule of ['TS2322', 'TS2345', 'prefer-const', 'eqeqeq', 'B006', 'complexity']) {
      expect(ground(rule), rule).toEqual(narrow);
    }
  });
});
