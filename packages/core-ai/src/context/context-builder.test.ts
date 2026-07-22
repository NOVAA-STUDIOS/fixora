import type { Finding } from '@fixora/shared-types';
import { describe, expect, it } from 'vitest';

import { buildContext, type ContextInput } from './context-builder.js';

const FILE = `import { z } from 'zod';

export function greet(name: string): string {
  const msg = 'hi ' + name;
  return msg;
}
`;

function makeFinding(): Finding {
  return {
    id: 'f1',
    source: 'eslint',
    ruleId: 'prefer-const',
    severity: 'warning',
    category: 'maintainability',
    location: { file: 'src/greet.ts', startLine: 4, startCol: 3, endLine: 4, endCol: 27 },
    message: 'Use template literals instead of string concatenation.',
    evidence: {
      snippet: "const msg = 'hi ' + name;",
      relatedLocations: [],
      toolOutput: {},
    },
    fixable: true,
    repair: 'ai-required',
    confidence: 1,
  };
}

function baseInput(overrides: Partial<ContextInput> = {}): ContextInput {
  return {
    filePath: 'src/greet.ts',
    language: 'typescript',
    fileContent: FILE,
    finding: makeFinding(),
    target: { symbolName: 'greet', startLine: 3, endLine: 6 },
    ...overrides,
  };
}

describe('context builder', () => {
  it('slices the whole enclosing symbol as the target — never a truncated function', () => {
    const context = buildContext(baseInput());
    expect(context.target.text).toContain('export function greet');
    expect(context.target.text.trimEnd().endsWith('}')).toBe(true);
    expect(context.target.symbolName).toBe('greet');
  });

  it('includes the finding as evidence and exposes it as a gate part', () => {
    const context = buildContext(baseInput());
    expect(context.evidenceText).toContain('prefer-const');
    expect(context.evidenceText).toContain("const msg = 'hi ' + name;");
    // The target slice and the evidence are both scanned by the gate.
    const labels = context.parts.map((p) => p.label);
    expect(labels).toContain('src/greet.ts');
    expect(labels).toContain('evidence:eslint');
  });

  it('keeps ranked neighbours when they fit', () => {
    const context = buildContext(
      baseInput({ neighbours: [{ label: 'import:zod', text: "import { z } from 'zod';" }] }),
    );
    expect(context.neighbours).toHaveLength(1);
    expect(context.droppedNeighbours).toBe(0);
    expect(context.parts.some((p) => p.label === 'import:zod')).toBe(true);
  });

  it('drops the lowest-ranked neighbours whole when over budget, never the target', () => {
    const big = 'x'.repeat(4000);
    const context = buildContext(
      baseInput({
        neighbours: [
          { label: 'n1', text: big },
          { label: 'n2', text: big },
        ],
        budget: { total: 200, reserveForOutput: 50 },
      }),
    );
    // Target + evidence are always present; the oversized neighbours are dropped whole.
    expect(context.droppedNeighbours).toBe(2);
    expect(context.neighbours).toHaveLength(0);
    expect(context.target.text).toContain('greet');
  });

  it('includes conventions when provided and within budget', () => {
    const context = buildContext(baseInput({ conventions: ['TypeScript strict mode'] }));
    expect(context.conventions).toContain('TypeScript strict mode');
    expect(context.parts.some((p) => p.label === 'conventions')).toBe(true);
  });
});
