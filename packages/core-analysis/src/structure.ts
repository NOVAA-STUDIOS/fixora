import type { Language, SymbolRef } from '@fixora/shared-types';

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
}

/** Parse `source` and extract its symbols, imports and call graph. `file` is the workspace-relative path. */
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
    };
  } finally {
    parsed.dispose();
  }
}
