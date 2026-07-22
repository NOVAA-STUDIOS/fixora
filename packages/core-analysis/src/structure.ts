import type { Language, SymbolRef } from '@fixora/shared-types';

import type { RepairScope } from './analyzer.js';
import { parse } from './parser/tree-sitter.js';
import { collectScopes, smallestScopeContaining } from './repair/scope-selector.js';
import {
  extractCalls,
  extractImports,
  extractSymbols,
  type CallEdge,
  type ExtractedImport,
} from './symbols/symbols.js';

export { smallestScopeContaining };

/**
 * The within-file structure the rest of the engine consumes: the symbols it declares, the modules it
 * imports, and its call graph (TDD §5). This is the one place that owns a tree's lifecycle — it
 * parses, reads everything into plain data, and disposes — so no caller ever thinks about WASM memory.
 */
export interface FileStructure {
  symbols: SymbolRef[];
  imports: ExtractedImport[];
  calls: CallEdge[];
  scopes: RepairScope[];
}

/** Parse `source` and extract its symbols, imports, call graph and repair scopes. */
export async function parseStructure(
  language: Language,
  source: string,
  file: string,
): Promise<FileStructure> {
  const parsed = await parse(language, source, file);
  try {
    const symbols = extractSymbols(parsed, language, file);
    return {
      symbols,
      imports: extractImports(parsed, language, file),
      calls: extractCalls(parsed, language, symbols, file),
      scopes: collectScopes(parsed.root, language),
    };
  } finally {
    parsed.dispose();
  }
}
