import type { Language, SymbolRef } from '@fixora/shared-types';
import { describe, expect, it } from 'vitest';

import type { AnalysisFile } from '../analyzer.js';
import { parseStructure } from '../structure.js';

import {
  isRelativeSpecifier,
  resolveRelativeImport,
  selectCrossFileContext,
} from './cross-file-context.js';

/**
 * Cross-file context (PR 2). Built on the real `parseStructure` over real source text — the same
 * discipline as the ranking and category tests — so what is asserted is what the live pipeline
 * produces, not a hand-shaped object that happens to satisfy the assertion.
 */

const TYPES_SRC = `export interface User {
  id: string;
  name: string;
}

export function unrelated(): void {}
`;

const MAIN_SRC = `import { User } from './types';
import { readFile } from 'node:fs';

export function greet(u: User): string {
  return u.name;
}
`;

const file = (path: string, language: Language = 'typescript'): AnalysisFile => ({
  file: path,
  absPath: `/ws/${path}`,
  language,
});

const FILES = [file('src/main.ts'), file('src/types.ts')];

async function symbolsFor(path: string, source: string): Promise<readonly SymbolRef[]> {
  return (await parseStructure('typescript', source, path)).symbols;
}

describe('isRelativeSpecifier', () => {
  it('accepts ./ and ../ only', () => {
    expect(isRelativeSpecifier('./types')).toBe(true);
    expect(isRelativeSpecifier('../shared/types')).toBe(true);
  });

  it('rejects bare and protocol specifiers — node_modules is out of scope', () => {
    for (const bare of ['react', 'node:fs', '@scope/pkg', 'lodash/merge']) {
      expect(isRelativeSpecifier(bare)).toBe(false);
    }
  });
});

describe('resolveRelativeImport', () => {
  it('resolves ./types to the sibling file, adding the extension', () => {
    expect(resolveRelativeImport('src/main.ts', './types', 'typescript', FILES)?.file).toBe(
      'src/types.ts',
    );
  });

  it('resolves ../ upward', () => {
    const files = [file('src/deep/a.ts'), file('src/types.ts')];
    expect(resolveRelativeImport('src/deep/a.ts', '../types', 'typescript', files)?.file).toBe(
      'src/types.ts',
    );
  });

  it('returns null for a bare specifier without touching the file set', () => {
    expect(resolveRelativeImport('src/main.ts', 'react', 'typescript', FILES)).toBeNull();
  });

  it('returns null when the target is not in the vetted file set — no crash', () => {
    expect(resolveRelativeImport('src/main.ts', './missing', 'typescript', FILES)).toBeNull();
  });
});

describe('selectCrossFileContext', () => {
  const run = async (overrides: Partial<Parameters<typeof selectCrossFileContext>[0]> = {}) => {
    const typeSymbols = await symbolsFor('src/types.ts', TYPES_SRC);
    return selectCrossFileContext({
      fromFile: 'src/main.ts',
      language: 'typescript',
      files: FILES,
      imports: [{ module: './types', statementText: "import { User } from './types';" }],
      referenced: new Set(['User', 'greet', 'u', 'name']),
      symbolsOf: (f) => (f.file === 'src/types.ts' ? typeSymbols : []),
      sourceOf: (f) => (f.file === 'src/types.ts' ? TYPES_SRC : MAIN_SRC),
      ...overrides,
    });
  };

  it('resolves a relative import to the referenced symbol’s definition', async () => {
    const out = await run();
    expect(out).toHaveLength(1);
    expect(out[0]?.label).toBe("from './types': interface User");
    expect(out[0]?.text).toContain('interface User');
    expect(out[0]?.text).toContain('id: string;');
  });

  it('skips a bare import entirely — never attempts resolution', async () => {
    const out = await run({
      imports: [{ module: 'node:fs', statementText: "import { readFile } from 'node:fs';" }],
      referenced: new Set(['readFile']),
    });
    expect(out).toEqual([]);
  });

  it('a missing target file yields no entry and does not throw', async () => {
    const out = await run({
      imports: [{ module: './nope', statementText: "import { User } from './nope';" }],
    });
    expect(out).toEqual([]);
  });

  it('unreadable source yields no entry rather than a corrupt one', async () => {
    const out = await run({ sourceOf: () => null });
    expect(out).toEqual([]);
  });

  it('a symbol the target never references is not pulled in', async () => {
    const out = await run({ referenced: new Set(['somethingElse']) });
    expect(out).toEqual([]);
  });

  it('a symbol not named by THIS import statement is not pulled in', async () => {
    // `unrelated` lives in types.ts and is referenced, but the import statement never names it.
    const out = await run({ referenced: new Set(['unrelated']) });
    expect(out).toEqual([]);
  });
});
