import type { SymbolRef } from '@fixora/shared-types';
import { describe, expect, it } from 'vitest';

import { parseStructure } from '../structure.js';

import { selectRepairContext } from './context-selector.js';

/**
 * Repair Context Engine v3 — the Semantic + Dependency scope selector. It must include the imports and
 * same-file declarations the target scope references BY NAME, and nothing else: not unrelated imports,
 * not the target itself, not the whole file.
 */

const SOURCE = `import { useEffect } from "react";
import { readFile } from "node:fs";
import { Unused } from "./unused";

interface Settings {
  count: number;
}

type Other = { x: number };

export const settings: Settings = {
  count: "hello",
};

export function greet(name: string): string {
  return name;
}
`;

async function structure(): Promise<{
  symbols: SymbolRef[];
  imports: { module: string; location: { startLine: number; endLine: number } }[];
}> {
  const s = await parseStructure('typescript', SOURCE, 'a.ts');
  return {
    symbols: s.symbols,
    imports: s.imports.map((i) => ({
      module: i.module,
      location: { startLine: i.location.startLine, endLine: i.location.endLine },
    })),
  };
}

describe('selectRepairContext (Semantic + Dependency scope)', () => {
  it('includes the same-file declaration the scope references (Settings), not the unrelated one (Other)', async () => {
    const { symbols, imports } = await structure();
    // The target scope is the object-literal declaration `export const settings: Settings = {…}`
    // (lines 11–13), which references `Settings`.
    const ranges = selectRepairContext({
      source: SOURCE,
      scopeStartLine: 11,
      scopeEndLine: 13,
      symbols,
      imports,
      targetSymbolName: null,
    });
    const labels = ranges.map((r) => r.label);
    expect(labels).toContain('interface Settings');
    expect(labels).not.toContain('type Other'); // referenced nowhere in the scope
  });

  it('includes the import a scope uses (react) and excludes imports it does not (node:fs, ./unused)', async () => {
    const { symbols, imports } = await structure();
    // A scope that uses `useEffect` (line 15 area) — reuse greet's body region but reference useEffect.
    const src = SOURCE.replace('  return name;', '  useEffect(() => {}, []);\n  return name;');
    const s = await parseStructure('typescript', src, 'b.ts');
    const imps = s.imports.map((i) => ({
      module: i.module,
      location: { startLine: i.location.startLine, endLine: i.location.endLine },
    }));
    // greet now spans lines 15–18 in the edited source.
    const ranges = selectRepairContext({
      source: src,
      scopeStartLine: 15,
      scopeEndLine: 18,
      symbols: s.symbols,
      imports: imps,
      targetSymbolName: 'greet',
    });
    const modules = ranges.map((r) => r.label);
    expect(modules).toContain("import from 'react'");
    expect(modules).not.toContain("import from 'node:fs'");
    expect(modules).not.toContain("import from './unused'");
    void symbols;
    void imports;
  });

  it('never includes the target symbol itself', async () => {
    const { symbols, imports } = await structure();
    // Target is `greet` (lines 15–17); its body references `name`, not another symbol.
    const ranges = selectRepairContext({
      source: SOURCE,
      scopeStartLine: 15,
      scopeEndLine: 17,
      symbols,
      imports,
      targetSymbolName: 'greet',
    });
    expect(ranges.map((r) => r.label)).not.toContain('function greet');
  });

  it('returns nothing for a scope that references no import or declaration', async () => {
    const plain = 'const a = 1;\nconst b = a + 2;\n';
    const s = await parseStructure('typescript', plain, 'p.ts');
    const ranges = selectRepairContext({
      source: plain,
      scopeStartLine: 2,
      scopeEndLine: 2,
      symbols: s.symbols,
      imports: [],
      targetSymbolName: null,
    });
    expect(ranges).toEqual([]);
  });
});
