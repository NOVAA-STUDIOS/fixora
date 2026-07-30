import { join } from 'node:path';

import type { Language } from '@fixora/shared-types';
import { describe, expect, it } from 'vitest';

import { createAnalysisContext } from '../context.js';

import { createSyntaxAnalyzer } from './syntax.js';

/**
 * The CSS and HTML Tier-B validators, run against the REAL tree-sitter grammars (no stubs) — the same
 * grammars the verification engine re-parses a repair with, so what these prove about detection also
 * holds for the post-repair gate.
 *
 * These languages were previously absent from `Language` entirely: silently skipped by analysis, then
 * refused by Repair/Proceed as "unsupported file type". The critical properties pinned here are that a
 * VALID file is silent (precision — a validator that cries wolf is worse than none) and that every
 * finding is `ai-required`, which is what makes it reach the repair pipeline at all.
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

async function run(language: 'css' | 'html', file: string, source: string) {
  const out = [];
  const analyzer = createSyntaxAnalyzer(language);
  for await (const f of analyzer.run(ctx(file, source, language), new AbortController().signal)) {
    out.push(f);
  }
  return out;
}

describe('CSS validator', () => {
  it('is silent on a valid stylesheet', async () => {
    const src = '.card {\n  color: #333;\n  background: white;\n}\n';
    expect(await run('css', 'styles.css', src)).toEqual([]);
  });

  it('reports an unclosed block with all M6 fields, repairable by AI', async () => {
    const src = '.card {\n  color: #333;\n';
    const findings = await run('css', 'styles.css', src);
    expect(findings.length).toBeGreaterThanOrEqual(1);
    const f = findings[0]!;
    expect(f.source).toBe('css');
    expect(f.ruleId).toBe('css-syntax');
    expect(f.severity).toBe('error');
    expect(f.category).toBe('correctness');
    expect(f.confidence).toBe(1);
    // The whole point: a CSS defect now reaches the AI repair path instead of being unrepairable.
    expect(f.repair).toBe('ai-required');
    expect(f.message).toContain('Invalid CSS');
  });

  it('catches a missed semicolon the grammar cannot see, with a DETERMINISTIC fix', async () => {
    // Measured: tree-sitter parses this as one valid declaration whose values swallow the next
    // property — `hasError` is false — so a grammar-only validator misses it entirely. The browser
    // drops the rule, so it is a real defect. This is the repo's own `samples/broken-css` shape.
    const src = '.card {\n  color: #333\n  background: white;\n  padding: 8px;\n}\n';
    const findings = await run('css', 'styles.css', src);
    expect(findings).toHaveLength(1);
    const f = findings[0]!;
    expect(f.ruleId).toBe('css-missing-semicolon');
    expect(f.severity).toBe('error');
    expect(f.location.startLine).toBe(2); // the `color: #333` line, where the `;` belongs
    // No model needed: a one-character edit at a known offset is `safe-auto`.
    expect(f.repair).toBe('safe-auto');
    expect(f.fixable).toBe(true);
    expect(f.autofix?.edits).toHaveLength(1);
    expect(f.autofix?.edits[0]?.text).toBe(';');
    // The fix, applied, must produce the corrected source.
    const [start, end] = f.autofix!.edits[0]!.range;
    expect(src.slice(0, start) + ';' + src.slice(end)).toBe(
      '.card {\n  color: #333;\n  background: white;\n  padding: 8px;\n}\n',
    );
  });

  it('does not mistake a colon inside url() or a string for a missed semicolon', async () => {
    // Precision guard: both of these are single, valid declarations that happen to contain a second
    // colon. Reporting them would make the check untrustworthy.
    expect(await run('css', 'a.css', '.a {\n  background: url(http://x/y.png);\n}\n')).toEqual([]);
    expect(await run('css', 'b.css', '.b {\n  grid-template-areas: "a: b";\n}\n')).toEqual([]);
  });

  it('does not flag a legitimate multi-value declaration', async () => {
    expect(await run('css', 'c.css', '.c {\n  font: bold 12px sans-serif;\n}\n')).toEqual([]);
    expect(await run('css', 'd.css', '.d {\n  margin: 0\n    auto;\n}\n')).toEqual([]);
  });

  it('skips files of another language entirely', async () => {
    const analyzer = createSyntaxAnalyzer('css');
    const out = [];
    for await (const f of analyzer.run(
      ctx('a.ts', 'const x: = 1;', 'typescript'),
      new AbortController().signal,
    )) {
      out.push(f);
    }
    expect(out).toEqual([]);
  });

  it('caps a catastrophically broken file rather than emitting thousands of rows', async () => {
    const src = '}{'.repeat(500);
    const findings = await run('css', 'broken.css', src);
    expect(findings.length).toBeLessThanOrEqual(20);
  });
});

describe('HTML validator', () => {
  it('is silent on a valid document', async () => {
    const src = '<!doctype html>\n<html>\n<body>\n<p>hi</p>\n</body>\n</html>\n';
    expect(await run('html', 'index.html', src)).toEqual([]);
  });

  it('reports malformed markup as a warning, not an error', async () => {
    // HTML's grammar recovers the way browsers do, so sloppy-but-working markup must not read as a
    // correctness error — that would flood a normal page with noise.
    const src = '<div><p>text</div>\n';
    const findings = await run('html', 'index.html', src);
    if (findings.length > 0) {
      expect(findings[0]?.source).toBe('html');
      expect(findings[0]?.ruleId).toBe('html-syntax');
      expect(findings[0]?.severity).toBe('warning');
      expect(findings[0]?.repair).toBe('ai-required');
    }
  });

  it('reports an unterminated tag', async () => {
    const src = '<div\n';
    const findings = await run('html', 'index.html', src);
    expect(findings.length).toBeGreaterThanOrEqual(1);
    expect(findings[0]?.ruleId).toBe('html-syntax');
    expect(findings[0]?.message).toContain('Invalid HTML');
  });
});

describe('syntax analyzers — shared contract', () => {
  it('both always apply: no external tool gates them', () => {
    const caps = { root: ROOT, tools: new Set<never>(), versions: new Map() };
    expect(createSyntaxAnalyzer('css').supports(caps)).toBe(true);
    expect(createSyntaxAnalyzer('html').supports(caps)).toBe(true);
  });

  it('reports one finding per independent defect, not one per nested error node', async () => {
    // Two unrelated unclosed rules are two real defects — but each must be reported once, from its
    // outermost error region, not once per level of the recovering parser's subtree.
    const src = '.a {\n  color: red\n\n.b {\n  color: blue\n';
    const findings = await run('css', 'styles.css', src);
    const lines = findings.map((f) => f.location.startLine);
    expect(new Set(lines).size).toBe(lines.length); // no duplicate locations
  });
});
