import { describe, expect, it } from 'vitest';

import { grammarFor } from './grammar-paths.js';
import { parse } from './tree-sitter.js';

/**
 * The .tsx grammar trap.
 *
 * TypeScript ships as two tree-sitter grammars: `typescript` (no JSX) and `tsx` (JSX). A `.tsx` file
 * is `Language: 'typescript'` for tool selection, but the plain typescript grammar reports the WHOLE
 * file as a syntax error the instant it meets a `<Tag>`. The verifier used that grammar, so `syntaxOk`
 * came back false for every valid React repair, the verdict became `regression`, and Apply was
 * disabled with "The fix does not parse" — a valid patch rejected. These pin the routing that fixes it
 * and, just as importantly, that a genuinely broken file is still caught.
 */

const VALID_TSX = `import { useEffect, useState } from 'react';

export function Counter({ start }: { start: number }) {
  const [count, setCount] = useState(start);
  useEffect(() => {
    setCount(start);
  }, [start]);
  return <button onClick={() => setCount(count + 1)}>{count}</button>;
}
`;

describe('grammarFor', () => {
  it('routes a .tsx file to the JSX-aware tsx grammar', () => {
    expect(grammarFor('typescript', 'src/Counter.tsx')).toBe('tsx');
    expect(grammarFor('typescript', 'DEEP/Nested.TSX')).toBe('tsx'); // case-insensitive
  });

  it('leaves a plain .ts file on the typescript grammar', () => {
    expect(grammarFor('typescript', 'src/util.ts')).toBe('typescript');
  });

  it('passes every other language straight through — .jsx already parses under javascript', () => {
    expect(grammarFor('javascript', 'src/App.jsx')).toBe('javascript');
    expect(grammarFor('python', 'a.py')).toBe('python');
    expect(grammarFor('go', 'a.go')).toBe('go');
  });
});

describe('parse — JSX syntax verification (the Apply blocker)', () => {
  it('parses a valid .tsx file WITHOUT a syntax error when the path is known', async () => {
    // This is the exact call the verifier makes. Before the fix it returned hasError === true.
    const tree = await parse('typescript', VALID_TSX, 'src/Counter.tsx');
    try {
      expect(tree.root.hasError).toBe(false); // syntaxOk = true -> verdict can be 'verified'
    } finally {
      tree.dispose();
    }
  });

  it('reproduces the bug: the same file parses as an error under the plain typescript grammar', async () => {
    // No path -> plain typescript grammar -> JSX is unparseable. Kept as an executable record of why
    // the path argument exists, so a future refactor that drops it fails here loudly.
    const tree = await parse('typescript', VALID_TSX);
    try {
      expect(tree.root.hasError).toBe(true);
    } finally {
      tree.dispose();
    }
  });

  it('STILL reports a genuinely broken .tsx as an error — verification is not weakened', async () => {
    const broken = VALID_TSX.replace('return <button', 'return <button <<<');
    const tree = await parse('typescript', broken, 'src/Counter.tsx');
    try {
      expect(tree.root.hasError).toBe(true);
    } finally {
      tree.dispose();
    }
  });

  it('parses a valid plain .ts file cleanly', async () => {
    const tree = await parse(
      'typescript',
      'export const add = (a: number, b: number) => a + b;\n',
      'src/add.ts',
    );
    try {
      expect(tree.root.hasError).toBe(false);
    } finally {
      tree.dispose();
    }
  });
});
