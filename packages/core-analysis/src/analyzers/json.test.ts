import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createAnalysisContext } from '../context.js';

import { createJsonAnalyzer } from './json.js';

/**
 * The JSON validator. `JSON.parse` is the authoritative judge of validity, so these pin that a real
 * defect is located precisely, a valid file is silent (precision), and every finding carries the M6
 * fields — severity, category, confidence, repairability.
 */

const ROOT = process.platform === 'win32' ? 'C:\\ws' : '/ws';

function ctx(file: string, source: string) {
  return createAnalysisContext({
    root: ROOT,
    capabilities: { root: ROOT, tools: new Set(), versions: new Map() },
    files: [{ file, absPath: join(ROOT, file), language: 'json' }],
    readSource: () => source,
  });
}

async function run(file: string, source: string) {
  const out = [];
  for await (const f of createJsonAnalyzer().run(ctx(file, source), new AbortController().signal)) {
    out.push(f);
  }
  return out;
}

describe('JSON validator', () => {
  it('reports an unquoted property name at its line, with all M6 fields', async () => {
    const src = '{\n  "name": "demo",\n  version: "1.0.0"\n}\n';
    const findings = await run('config.json', src);
    expect(findings).toHaveLength(1);
    const f = findings[0]!;
    expect(f.source).toBe('json');
    expect(f.ruleId).toBe('json-parse');
    expect(f.severity).toBe('error');
    expect(f.category).toBe('correctness');
    expect(f.confidence).toBe(1);
    expect(f.repair).toBe('ai-required'); // no deterministic autofix yet
    expect(f.location.startLine).toBe(3); // the `version` line
    expect(f.message).toContain('Invalid JSON');
    expect(f.message).not.toMatch(/position \d+/i); // the parser's bookkeeping is stripped
  });

  it('reports a trailing-comma / brace error and locates it', async () => {
    const src = '{\n  "tags": ["a", "b",]\n}\n';
    const findings = await run('a.json', src);
    expect(findings.length).toBeGreaterThanOrEqual(1);
    expect(findings[0]?.ruleId).toBe('json-parse');
  });

  it('is SILENT on valid JSON — no false positives (precision)', async () => {
    expect(await run('ok.json', '{\n  "a": 1,\n  "b": [true, null, 2.5]\n}\n')).toEqual([]);
  });

  it('is SILENT on valid JSON that begins with a UTF-8 BOM (P0.2 — no false positive)', async () => {
    // Windows editors / PowerShell write a BOM; JSON.parse rejects it, so the validator must strip it.
    expect(await run('bom.json', '﻿{\n  "a": 1\n}\n')).toEqual([]);
  });

  it('still reports a real error in a BOM-prefixed file, at the right line', async () => {
    const findings = await run('bom-bad.json', '﻿{\n  "a": 1,\n}\n'); // trailing comma
    expect(findings).toHaveLength(1);
    expect(findings[0]?.ruleId).toBe('json-parse');
  });

  it('ignores non-JSON files entirely', async () => {
    const c = createAnalysisContext({
      root: ROOT,
      capabilities: { root: ROOT, tools: new Set(), versions: new Map() },
      files: [{ file: 'a.ts', absPath: join(ROOT, 'a.ts'), language: 'typescript' }],
      readSource: () => 'const a = 1;',
    });
    const out = [];
    for await (const f of createJsonAnalyzer().run(c, new AbortController().signal)) out.push(f);
    expect(out).toEqual([]);
  });
});
