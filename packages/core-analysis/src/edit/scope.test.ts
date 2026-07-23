import { describe, expect, it } from 'vitest';

import { resolveEditScope } from './scope.js';

/**
 * Scope detection must return the SMALLEST valid scope containing the selection — the tightest
 * enclosing symbol — and must never widen to the whole file. When nothing encloses the selection it
 * falls back to exactly the selected lines. It reuses the analyzer's real symbol extraction.
 */

const TS = `import { z } from 'zod';

export function greet(name: string): string {
  const msg = 'hi ' + name;
  return msg;
}

export function farewell(name: string): string {
  return 'bye ' + name;
}
`;

describe('resolveEditScope', () => {
  it('selects the smallest enclosing function for a caret inside it', async () => {
    const scope = await resolveEditScope({
      source: TS,
      language: 'typescript',
      filePath: 'a.ts',
      selectionStartLine: 4, // inside greet()
    });
    expect(scope.basis).toBe('enclosing-symbol');
    expect(scope.symbolName).toBe('greet');
    expect(scope.startLine).toBe(3);
    expect(scope.endLine).toBe(6);
    expect(scope.text).toContain('const msg');
    expect(scope.text).not.toContain('farewell'); // never widened past the enclosing symbol
  });

  it('picks the function that contains the whole selection range', async () => {
    const scope = await resolveEditScope({
      source: TS,
      language: 'typescript',
      filePath: 'a.ts',
      selectionStartLine: 8,
      selectionEndLine: 10, // farewell()
    });
    expect(scope.symbolName).toBe('farewell');
  });

  it('falls back to exactly the selected lines when nothing encloses them (never the whole file)', async () => {
    const scope = await resolveEditScope({
      source: TS,
      language: 'typescript',
      filePath: 'a.ts',
      selectionStartLine: 1, // the top-level import — not inside any function symbol
    });
    expect(scope.basis).toBe('selection-fallback');
    expect(scope.startLine).toBe(1);
    expect(scope.endLine).toBe(1);
    expect(scope.text).toContain('import { z }');
  });

  it('clamps an out-of-range selection into the file rather than throwing', async () => {
    const scope = await resolveEditScope({
      source: TS,
      language: 'typescript',
      filePath: 'a.ts',
      selectionStartLine: 9999,
    });
    expect(scope.startLine).toBeLessThanOrEqual(TS.split('\n').length);
    expect(scope.endLine).toBeLessThanOrEqual(TS.split('\n').length);
  });
});
