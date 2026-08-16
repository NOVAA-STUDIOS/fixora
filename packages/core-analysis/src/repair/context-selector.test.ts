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

/**
 * Relevance ranking, before the cap.
 *
 * Ordering only — the same candidates stay eligible and MAX_NEIGHBOURS still bounds the total.
 * Built on the real `parseStructure` (like every test above), not hand-made symbol objects, so
 * what is asserted is what the live pipeline produces.
 *
 * The fixture is deliberately unconfounded: `Omega` is BOTH farther from the finding (50 lines vs
 * 9) AND declared later, so it loses on proximity and on array order. If naming it in the
 * diagnostic still puts it first, the reference signal is doing the work — nothing else could.
 */
const RANK_SOURCE = "interface Alpha { a: number; }\n// filler 0\n// filler 1\n// filler 2\n// filler 3\n// filler 4\n// filler 5\n// filler 6\n// filler 7\nexport const thing: Alpha = { a: (null as unknown as Omega).z };\n// pad 0\n// pad 1\n// pad 2\n// pad 3\n// pad 4\n// pad 5\n// pad 6\n// pad 7\n// pad 8\n// pad 9\n// pad 10\n// pad 11\n// pad 12\n// pad 13\n// pad 14\n// pad 15\n// pad 16\n// pad 17\n// pad 18\n// pad 19\n// pad 20\n// pad 21\n// pad 22\n// pad 23\n// pad 24\n// pad 25\n// pad 26\n// pad 27\n// pad 28\n// pad 29\n// pad 30\n// pad 31\n// pad 32\n// pad 33\n// pad 34\n// pad 35\n// pad 36\n// pad 37\n// pad 38\n// pad 39\n// pad 40\n// pad 41\n// pad 42\n// pad 43\n// pad 44\n// pad 45\n// pad 46\n// pad 47\n// pad 48\ninterface Omega { z: number; }";

async function rankStructure() {
  const s = await parseStructure('typescript', RANK_SOURCE, 'r.ts');
  return {
    symbols: s.symbols,
    imports: s.imports.map((i) => ({
      module: i.module,
      location: { startLine: i.location.startLine, endLine: i.location.endLine },
    })),
  };
}

describe('selectRepairContext — relevance ranking', () => {
  it('a declaration named in the diagnostic outranks a nearer, earlier-declared one', async () => {
    const { symbols, imports } = await rankStructure();
    const ranked = selectRepairContext({
      source: RANK_SOURCE,
      scopeStartLine: 10,
      scopeEndLine: 10,
      symbols,
      imports,
      targetSymbolName: 'thing',
      findingLine: 10,
      diagnosticText: "Property 'z' does not exist on type 'Omega'.",
    });
    expect(ranked.map((r) => r.label)).toEqual(['interface Omega', 'interface Alpha']);
  });

  it('without the diagnostic, the nearer/earlier one leads — proving the signal changed it', async () => {
    const { symbols, imports } = await rankStructure();
    const unranked = selectRepairContext({
      source: RANK_SOURCE,
      scopeStartLine: 10,
      scopeEndLine: 10,
      symbols,
      imports,
      targetSymbolName: 'thing',
    });
    expect(unranked.map((r) => r.label)).toEqual(['interface Alpha', 'interface Omega']);
  });

  it('ranking reorders but never adds or drops a candidate', async () => {
    const { symbols, imports } = await rankStructure();
    const base = {
      source: RANK_SOURCE,
      scopeStartLine: 10,
      scopeEndLine: 10,
      symbols,
      imports,
      targetSymbolName: 'thing',
    };
    const a = selectRepairContext(base).map((r) => r.label).sort();
    const b = selectRepairContext({
      ...base,
      findingLine: 10,
      diagnosticText: "Property 'z' does not exist on type 'Omega'.",
    })
      .map((r) => r.label)
      .sort();
    expect(b).toEqual(a);
  });
});
