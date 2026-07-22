import type { Finding } from '@fixora/shared-types';
import { describe, expect, it } from 'vitest';

import { applyEdits, classifyRepair, deterministicRepair } from './micro-repair.js';

/**
 * Deterministic micro-repairs. The fix always comes from a tool's own AST-based fixer (here supplied
 * as ESLint-shaped edits); these pin that the edit is applied exactly, that a fix which does not parse
 * is caught by the parser gate, and that classification never over-promises.
 */

function finding(over: Partial<Finding>): Finding {
  return {
    id: 'x',
    source: 'eslint',
    ruleId: 'semi',
    severity: 'warning',
    category: 'style',
    location: { file: 'a.ts', startLine: 1, startCol: 1, endLine: 1, endCol: 1 },
    message: 'Missing semicolon.',
    evidence: { snippet: '', relatedLocations: [], toolOutput: null },
    fixable: true,
    repair: 'ai-required',
    confidence: 1,
    ...over,
  };
}

describe('applyEdits', () => {
  it('applies a single-token insertion at an offset (the canonical micro-repair)', () => {
    // `const a = 1` -> `const a = 1;`  (insert ';' at offset 11)
    expect(applyEdits('const a = 1', [{ range: [11, 11], text: ';' }])).toBe('const a = 1;');
  });

  it('preserves CRLF endings exactly — offset splicing never touches surrounding line endings', () => {
    // A CRLF file; remove the unused `os` import (offsets [0,10) = "import os\r\n"... but here the
    // edit lands mid-file). The surrounding \r\n must survive byte-for-byte.
    const crlf = 'const a = 1;\r\nconst b = 2;\r\nconst c = 3;\r\n';
    // Replace "2" (offset of the 2 in line 2). "const a = 1;\r\n" is 14 chars; "const b = " is 10 → 24.
    const out = applyEdits(crlf, [{ range: [24, 25], text: '20' }]);
    expect(out).toBe('const a = 1;\r\nconst b = 20;\r\nconst c = 3;\r\n');
    expect(/(?<!\r)\n/.test(out ?? '')).toBe(false); // no lone LF introduced
  });

  it('applies multiple edits without offsets drifting', () => {
    // Replace both quotes: 'a' -> "a", at two separate ranges.
    const out = applyEdits(`x = 'a'`, [
      { range: [4, 5], text: '"' },
      { range: [6, 7], text: '"' },
    ]);
    expect(out).toBe('x = "a"');
  });

  it('refuses an out-of-bounds edit rather than corrupting the file', () => {
    expect(applyEdits('abc', [{ range: [2, 99], text: 'z' }])).toBeNull();
  });

  it('refuses overlapping edits — the result would be ambiguous', () => {
    expect(
      applyEdits('abcdef', [
        { range: [0, 3], text: 'X' },
        { range: [2, 5], text: 'Y' },
      ]),
    ).toBeNull();
  });
});

describe('classifyRepair (Goal 5)', () => {
  it('is safe-auto when the tool shipped a fix', () => {
    expect(
      classifyRepair(
        finding({ autofix: { source: 'eslint', edits: [{ range: [0, 0], text: ';' }] } }),
      ),
    ).toBe('safe-auto');
  });

  it('is manual for a rule whose intent a machine cannot know (TS2304)', () => {
    expect(classifyRepair(finding({ source: 'tsc', ruleId: 'TS2304', fixable: false }))).toBe(
      'manual',
    );
  });

  it('is ai-required when there is no autofix and the rule is not manual-only', () => {
    expect(classifyRepair(finding({ ruleId: 'react-hooks/exhaustive-deps', fixable: false }))).toBe(
      'ai-required',
    );
  });
});

describe('deterministicRepair — the parser gate', () => {
  it('returns null when the finding has no tool-authored fix', async () => {
    const r = await deterministicRepair({
      finding: finding({ fixable: false }),
      source: 'const a = 1;\n',
      language: 'typescript',
      filePath: 'a.ts',
    });
    expect(r).toBeNull();
  });

  it('produces a parse-valid patch for a real one-token fix', async () => {
    const r = await deterministicRepair({
      finding: finding({
        autofix: { source: 'eslint', edits: [{ range: [11, 11], text: ';' }] },
      }),
      source: 'const a = 1\n',
      language: 'typescript',
      filePath: 'a.ts',
    });
    expect(r).not.toBeNull();
    expect(r!.patched).toBe('const a = 1;\n');
    expect(r!.parseOk).toBe(true); // parser gate passes
    expect(r!.edits).toHaveLength(1);
  });

  it('reports parseOk=false when the tool fix would break the file — the gate does its job', async () => {
    // A deliberately broken "fix": insert an unbalanced brace. No real linter emits this, but the gate
    // must not depend on the linter being perfect — a fix that does not parse is never applicable.
    const r = await deterministicRepair({
      finding: finding({
        autofix: { source: 'eslint', edits: [{ range: [11, 11], text: ';}{' }] },
      }),
      source: 'const a = 1\n',
      language: 'typescript',
      filePath: 'a.ts',
    });
    expect(r).not.toBeNull();
    expect(r!.parseOk).toBe(false);
  });

  it('parses a .tsx patch with the JSX grammar (the fix does not regress on React files)', async () => {
    const src = `export const C = () => <div className='a'>x</div>\n`;
    const r = await deterministicRepair({
      finding: finding({
        location: { file: 'C.tsx', startLine: 1, startCol: 1, endLine: 1, endCol: 1 },
        autofix: {
          source: 'eslint',
          edits: [{ range: [src.length - 1, src.length - 1], text: ';' }],
        },
      }),
      source: src,
      language: 'typescript',
      filePath: 'C.tsx',
    });
    expect(r!.parseOk).toBe(true);
  });
});
