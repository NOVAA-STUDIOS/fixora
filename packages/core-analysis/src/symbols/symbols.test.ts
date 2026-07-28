import { describe, expect, it } from 'vitest';

import { parse } from '../parser/tree-sitter.js';

import { enclosingSymbol, extractSymbols } from './symbols.js';

/**
 * Symbol extraction and enclosing-symbol lookup — the grounding every analyzer's `Finding` relies on
 * (`evidence.enclosingSymbol`, repair scope, finding-id stability, the within-file call graph's `from`
 * attribution). No dedicated test file existed for `symbols.ts` before this; these pin the shapes
 * measured to be broken plus the ones already working, so a future change can't silently regress either.
 */

async function symbolsOf(source: string, file = 'src/x.tsx') {
  const parsed = await parse('typescript', source, file);
  try {
    return extractSymbols(parsed, 'typescript', file);
  } finally {
    parsed.dispose();
  }
}

describe('extractSymbols — higher-order-wrapped components', () => {
  it('resolves a component wrapped in memo() to its own symbol (was completely invisible)', async () => {
    const src = `import { memo } from 'react';

export const Counter = memo(({ start }: { start: number }) => {
  return <button>{start}</button>;
});
`;
    const symbols = await symbolsOf(src);
    expect(symbols).toHaveLength(1);
    expect(symbols[0]?.name).toBe('Counter');
    expect(symbols[0]?.kind).toBe('function');
    // A finding on the JSX return line must ground to `Counter`, not fall through to "no symbol".
    expect(enclosingSymbol(symbols, 4)?.name).toBe('Counter');
  });

  it('resolves a component wrapped in forwardRef() the same way', async () => {
    const src = `import { forwardRef } from 'react';

export const Input = forwardRef(function Input(props, ref) {
  return <input ref={ref} {...props} />;
});
`;
    const symbols = await symbolsOf(src);
    expect(symbols.some((s) => s.name === 'Input')).toBe(true);
    expect(enclosingSymbol(symbols, 4)?.name).toBe('Input');
  });

  it('does not misfire when the wrapped first argument is not a function', async () => {
    // Guards the narrow trigger: `Object.freeze(config)` must not be mistaken for a component.
    const src = `export const frozen = Object.freeze(config);\n`;
    const symbols = await symbolsOf(src);
    expect(symbols).toHaveLength(0);
  });

  it('still resolves a directly-assigned arrow function (no regression)', async () => {
    const src = `export const Simple = () => {\n  return null;\n};\n`;
    const symbols = await symbolsOf(src);
    expect(symbols).toHaveLength(1);
    expect(symbols[0]?.name).toBe('Simple');
  });

  it('still resolves a plain function declaration (no regression)', async () => {
    const src = `export function Plain() {\n  return null;\n}\n`;
    const symbols = await symbolsOf(src);
    expect(symbols).toHaveLength(1);
    expect(symbols[0]?.name).toBe('Plain');
  });
});
