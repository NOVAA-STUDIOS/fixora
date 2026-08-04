import { join } from 'node:path';

import type { Language } from '@fixora/shared-types';
import { describe, expect, it } from 'vitest';

import { createAnalysisContext } from '../context.js';
import { parse } from '../parser/tree-sitter.js';

import { createSyntaxAnalyzer, isTailwindDirectiveLine } from './syntax.js';

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

/**
 * Repair-target regression (CSS). A `css-missing-semicolon` finding carried no `enclosingRange`, so
 * `ai-service.ts` fell back to the finding's own line — a bare `color: #333` declaration, which does
 * NOT parse standalone. An AI repair was therefore generated against a fragment, and splicing the
 * reply back over that one mid-rule line produced a file the parser gate rejected: "Apply is
 * disabled — parser failed." The delimiter path in this same analyzer already resolved an enclosing
 * range for exactly this reason; the semicolon path did not.
 */
describe('css-missing-semicolon carries a spliceable repair target', () => {
  const BROKEN = '.card {\n  color: #333\n  background: white;\n  padding: 8px;\n}\n';

  it('resolves an enclosingRange covering the whole rule, not the bare declaration line', async () => {
    const findings = await run('css', 'styles.css', BROKEN);
    const semi = findings.find((f) => f.ruleId === 'css-missing-semicolon');
    expect(semi).toBeDefined();
    const range = semi?.evidence.enclosingRange;
    expect(range).toBeDefined();
    // The whole `.card { … }` rule — a construct that parses on its own and splices back cleanly.
    expect(range?.startLine).toBe(1);
    expect(range?.endLine).toBe(5);
    // The defect's own line must be inside it, or the model never sees what it is meant to fix.
    expect(semi?.location.startLine).toBeGreaterThanOrEqual(range?.startLine ?? 0);
    expect(semi?.location.startLine).toBeLessThanOrEqual(range?.endLine ?? 0);
  });

  it('the resolved target parses standalone — the property the bare line lacked', async () => {
    const findings = await run('css', 'styles.css', BROKEN);
    const range = findings.find((f) => f.ruleId === 'css-missing-semicolon')?.evidence.enclosingRange;
    const lines = BROKEN.split('\n');
    const slice = lines.slice((range?.startLine ?? 1) - 1, range?.endLine ?? 1).join('\n');
    const tree = await parse('css', slice, 'styles.css');
    const ok = !tree.root.hasError;
    tree.dispose();
    expect(ok).toBe(true);

    // And the bare finding line — the old fallback target — demonstrably does not.
    const bare = lines[1] ?? '';
    const bareTree = await parse('css', bare, 'styles.css');
    const bareOk = !bareTree.root.hasError;
    bareTree.dispose();
    expect(bareOk).toBe(false);
  });
});

/**
 * Tailwind CSS v4 fixtures.
 *
 * `tree-sitter-css` predates Tailwind v4 and cannot read several of its at-rules, so it reported
 * each one as "Invalid CSS: this is not valid CSS syntax". On a real Laravel/Tailwind `app.css` that
 * is every `@source` line — false positives that buried the genuine findings and offered Repair on
 * code that was not broken. Suppressed by directive, never by weakening the parser gate.
 */
describe('CSS: Tailwind v4 directives are not syntax errors', () => {
  const silent = async (source: string) => (await run('css', 'app.css', source)).length;

  it('reports nothing for the directives the grammar cannot read', async () => {
    expect(await silent("@source '../**/*.blade.php';\n")).toBe(0);
    expect(await silent('@plugin "@tailwindcss/typography";\n')).toBe(0);
    expect(await silent('@variant dark (&:where(.dark *));\n')).toBe(0);
    expect(await silent('@custom-variant hocus (&:hover, &:focus);\n')).toBe(0);
    expect(await silent('@reference "../app.css";\n')).toBe(0);
    expect(await silent('@config "../tailwind.config.js";\n')).toBe(0);
  });

  it('reports nothing for the directives that already parsed — unchanged behaviour', async () => {
    expect(await silent("@import 'tailwindcss';\n")).toBe(0);
    expect(await silent('@theme { --font-sans: sans-serif; }\n')).toBe(0);
    expect(await silent('@utility btn { color: red; }\n')).toBe(0);
    expect(await silent('.a { @apply flex; }\n')).toBe(0);
  });

  it('is silent on a realistic Tailwind v4 entrypoint', async () => {
    const appCss = [
      "@import 'tailwindcss';",
      '',
      "@source '../../vendor/laravel/framework/src/Illuminate/Pagination/resources/views/*.blade.php';",
      "@source '../../storage/framework/views/*.php';",
      "@source '../**/*.blade.php';",
      '',
      '@theme {',
      "    --font-sans: 'Instrument Sans', ui-sans-serif, system-ui, sans-serif;",
      '}',
      '',
    ].join('\n');
    expect(await run('css', 'app.css', appCss)).toEqual([]);
  });

  /** The suppression must be surgical: it keys on the directive LINE, never on the whole file. */
  it('still reports a genuine error on a non-directive line in a Tailwind file', async () => {
    const source = "@source '../**/*.js';\n.a { color: red\n.b { color: blue; }\n";
    const findings = await run('css', 'app.css', source);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.ruleId).toBe('css-syntax');
    // Line 3 — inside the rule blocks, NOT the suppressed directive on line 1.
    expect(findings[0]?.location.startLine).toBe(3);
  });

  it('still reports genuine CSS syntax errors with no Tailwind present', async () => {
    const unbalanced = await run('css', 'a.css', '.a { color: red\n.b { color: blue; }\n');
    expect(unbalanced.map((f) => f.ruleId)).toContain('css-syntax');
    const stray = await run('css', 'b.css', '.a { color: red; }\n}\n');
    expect(stray.map((f) => f.ruleId)).toContain('css-syntax');
  });

  /** An unrecognised at-rule of ordinary shape already parses, so it must NOT be on the allow-list. */
  it('does not blanket-suppress every at-rule — only the shapes the grammar cannot read', async () => {
    // Parses cleanly today, so it was never a false positive and needs no entry.
    expect(await silent('@definitelynotreal foo;\n')).toBe(0);
    // A real defect on a line opening with a NON-Tailwind at-rule is still reported.
    const broken = await run('css', 'c.css', '@media (min-width: 600px) {\n  .a { color: red\n');
    expect(broken.length).toBeGreaterThan(0);
  });
});

/**
 * The verifier shares this vocabulary. `analysis-worker.mjs` re-parses the PATCHED file to compute
 * `syntaxOk`, and it used `tree.root.hasError` directly — which is always true for a Tailwind v4
 * stylesheet because of its `@source`/`@plugin`/`@variant` lines. Analysis therefore called the file
 * clean while verification called it unparseable, and Apply was refused for every valid repair in
 * such a file ("Apply is disabled — parser failed"). Both sides now consult this predicate.
 */
describe('isTailwindDirectiveLine — the shared analyzer/verifier vocabulary', () => {
  it('recognises the directives the CSS grammar cannot read', () => {
    for (const line of [
      "@source '../**/*.blade.php';",
      '  @plugin "@tailwindcss/typography";',
      '@variant dark (&:where(.dark *));',
      '@custom-variant hocus (&:hover);',
      '@reference "../app.css";',
      '@config "../tailwind.config.js";',
    ]) {
      expect(isTailwindDirectiveLine(line), line).toBe(true);
    }
  });

  it('does NOT claim directives that parse fine, so real errors inside them stay visible', () => {
    for (const line of [
      "@import 'tailwindcss';",
      '@theme {',
      '@utility btn {',
      '@media (min-width: 600px) {',
      '@keyframes spin {',
      '.card { color: red; }',
      '',
    ]) {
      expect(isTailwindDirectiveLine(line), line).toBe(false);
    }
  });
});
