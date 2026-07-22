import type { Language, SymbolRef } from '@fixora/shared-types';

import type { BlockRange } from './analyzer.js';
import { parse } from './parser/tree-sitter.js';
import {
  extractCalls,
  extractImports,
  extractSymbols,
  type CallEdge,
  type ExtractedImport,
} from './symbols/symbols.js';

/**
 * The within-file structure the rest of the engine consumes: the symbols it declares, the modules it
 * imports, and its call graph (TDD §5). This is the one place that owns a tree's lifecycle — it
 * parses, reads everything into plain data, and disposes — so no caller ever thinks about WASM memory.
 */
export interface FileStructure {
  symbols: SymbolRef[];
  imports: ExtractedImport[];
  calls: CallEdge[];
  blocks: BlockRange[];
}

/** Parse `source` and extract its symbols, imports, call graph and top-level block ranges. */
export async function parseStructure(
  language: Language,
  source: string,
  file: string,
): Promise<FileStructure> {
  const parsed = await parse(language, source, file);
  try {
    const symbols = extractSymbols(parsed, language, file);
    const blocks: BlockRange[] = [];
    for (let i = 0; i < parsed.root.namedChildCount; i++) {
      const child = parsed.root.namedChild(i);
      if (child === null) continue;
      blocks.push({
        startLine: child.startPosition.row + 1,
        endLine: child.endPosition.row + 1,
      });
    }
    return {
      symbols,
      imports: extractImports(parsed, language, file),
      calls: extractCalls(parsed, language, symbols, file),
      blocks,
    };
  } finally {
    parsed.dispose();
  }
}

/** The smallest top-level block containing `line`, or null if none does (e.g. a blank line). */
export function blockContaining(blocks: readonly BlockRange[], line: number): BlockRange | null {
  let best: BlockRange | null = null;
  for (const b of blocks) {
    if (line < b.startLine || line > b.endLine) continue;
    if (best === null || b.endLine - b.startLine < best.endLine - best.startLine) best = b;
  }
  return best;
}
