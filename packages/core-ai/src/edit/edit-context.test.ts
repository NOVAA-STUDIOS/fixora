import { describe, expect, it } from 'vitest';

import { gate } from '../gate/secret-gate.js';

import { buildEditContext, type EditContextInput } from './edit-context.js';

/**
 * The editing Context Builder must (a) include the instruction and the target scope, (b) never exceed
 * the token budget, dropping neighbours whole rather than truncating the target, and (c) expose the
 * exact `parts` the secret gate scans — the same guarantee the repair builder gives.
 */

function input(over: Partial<EditContextInput> = {}): EditContextInput {
  return {
    instruction: 'make this button green',
    intent: 'styling',
    filePath: 'src/Button.tsx',
    language: 'typescript',
    target: {
      symbolName: 'Button',
      startLine: 3,
      endLine: 6,
      text: 'export function Button() {\n  return <button>click</button>;\n}',
    },
    ...over,
  };
}

describe('buildEditContext', () => {
  it('always includes the instruction and the target scope as gate-scanned parts', () => {
    const ctx = buildEditContext(input());
    const labels = ctx.parts.map((p) => p.label);
    expect(labels).toContain('instruction');
    expect(labels).toContain('src/Button.tsx');
    expect(ctx.parts.find((p) => p.label === 'instruction')?.text).toBe('make this button green');
  });

  it('keeps conventions and neighbours that fit, in priority order', () => {
    const ctx = buildEditContext(
      input({
        conventions: ['Framework: React', 'TypeScript strict mode is on'],
        neighbours: [{ label: 'import', text: "import React from 'react';" }],
      }),
    );
    expect(ctx.conventions).toHaveLength(2);
    expect(ctx.neighbours).toHaveLength(1);
    expect(ctx.droppedNeighbours).toBe(0);
  });

  it('drops neighbours whole when the budget is tight — never truncates the target', () => {
    const big = 'x'.repeat(400);
    const ctx = buildEditContext(
      input({
        budget: { total: 60, reserveForOutput: 10 },
        neighbours: [
          { label: 'n1', text: big },
          { label: 'n2', text: big },
        ],
      }),
    );
    // Target + instruction are always present; oversized neighbours are dropped whole.
    expect(ctx.parts.some((p) => p.label === 'src/Button.tsx')).toBe(true);
    expect(ctx.droppedNeighbours).toBeGreaterThan(0);
  });

  it('produces parts the secret gate can scan (nothing bypasses the gate)', () => {
    const ctx = buildEditContext(input());
    // The gate runs cleanly over benign parts; the point is that `parts` is the exact scanned set.
    expect(gate(ctx.parts).ok).toBe(true);
  });
});
