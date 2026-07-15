import type { Language, Location, SymbolKind, SymbolRef } from '@fixora/shared-types';
import { type Node, Query } from 'web-tree-sitter';

import type { ParsedTree } from '../parser/tree-sitter.js';

import { CALL_QUERIES, IMPORT_QUERIES, SYMBOL_KIND_CAPTURES, SYMBOL_QUERIES } from './queries.js';

/**
 * Symbol and import extraction over a parsed tree (TDD §5.2). The output is **plain data** —
 * `SymbolRef[]`, positions as numbers — so nothing here escapes holding a WASM node past the tree's
 * `dispose()`. Symbols carry their full declaration span, which is what makes enclosing-symbol
 * lookup (the `Finding.evidence.enclosingSymbol`) a range test rather than another parse.
 */

const KIND_CAPTURE_SET = new Set<string>(SYMBOL_KIND_CAPTURES);

/** tree-sitter positions are 0-based row/column; a `Location` is 1-based (what an editor shows). */
function toLocation(node: Node, file: string): Location {
  return {
    file,
    startLine: node.startPosition.row + 1,
    startCol: node.startPosition.column + 1,
    endLine: node.endPosition.row + 1,
    endCol: node.endPosition.column + 1,
  };
}

/** A Python `def` is a method when it sits directly in a class body (`block` under `class_definition`). */
function refineKind(kind: SymbolKind, language: Language, declaration: Node): SymbolKind {
  if (language === 'python' && kind === 'function') {
    const parent = declaration.parent;
    if (parent?.type === 'block' && parent.parent?.type === 'class_definition') return 'method';
  }
  return kind;
}

export interface ExtractedImport {
  module: string;
  location: Location;
}

/** Strip a single pair of matching surrounding quotes (grammar string nodes include them). */
function unquote(text: string): string {
  const first = text[0];
  if ((first === '"' || first === "'" || first === '`') && text.at(-1) === first) {
    return text.slice(1, -1);
  }
  return text;
}

/**
 * Every named symbol declared in the file, in document order. `file` is the workspace-relative path
 * the locations are reported against.
 */
export function extractSymbols(parsed: ParsedTree, language: Language, file: string): SymbolRef[] {
  const query = new Query(parsed.grammar, SYMBOL_QUERIES[language]);
  try {
    const symbols: SymbolRef[] = [];
    for (const match of query.matches(parsed.root)) {
      let declaration: Node | undefined;
      let nameNode: Node | undefined;
      let kind: SymbolKind | undefined;
      for (const capture of match.captures) {
        if (capture.name === 'symbol') {
          declaration = capture.node;
        } else if (KIND_CAPTURE_SET.has(capture.name)) {
          nameNode = capture.node;
          kind = capture.name as SymbolKind;
        }
      }
      if (declaration === undefined || nameNode === undefined || kind === undefined) continue;
      symbols.push({
        name: nameNode.text,
        kind: refineKind(kind, language, declaration),
        location: toLocation(declaration, file),
      });
    }
    symbols.sort((a, b) => a.location.startLine - b.location.startLine);
    return symbols;
  } finally {
    query.delete();
  }
}

/** Every module a file imports, in document order (within-file dependency edges, TDD §5). */
export function extractImports(
  parsed: ParsedTree,
  language: Language,
  file: string,
): ExtractedImport[] {
  const query = new Query(parsed.grammar, IMPORT_QUERIES[language]);
  try {
    const imports: ExtractedImport[] = [];
    for (const capture of query.captures(parsed.root)) {
      if (capture.name !== 'source') continue;
      imports.push({
        module: unquote(capture.node.text),
        location: toLocation(capture.node, file),
      });
    }
    return imports;
  } finally {
    query.delete();
  }
}

/** A within-file call edge: `from` is the enclosing symbol's name (null at top level), `callee` the name called. */
export interface CallEdge {
  from: string | null;
  callee: string;
  location: Location;
}

/**
 * The within-file call graph (TDD §5): every call site attributed to the symbol it sits in. Edges
 * whose `callee` matches a local symbol are internal (the file's own structure); edges to anything
 * else are calls out. Callee resolution is by *name* — deliberately not type-aware, because this is
 * grounding evidence for later reasoning, not a compiler's resolver.
 */
export function extractCalls(
  parsed: ParsedTree,
  language: Language,
  symbols: readonly SymbolRef[],
  file: string,
): CallEdge[] {
  const query = new Query(parsed.grammar, CALL_QUERIES[language]);
  try {
    const edges: CallEdge[] = [];
    for (const capture of query.captures(parsed.root)) {
      if (capture.name !== 'callee') continue;
      const location = toLocation(capture.node, file);
      edges.push({
        from: enclosingSymbol(symbols, location.startLine)?.name ?? null,
        callee: capture.node.text,
        location,
      });
    }
    return edges;
  } finally {
    query.delete();
  }
}

/**
 * The innermost symbol whose span contains `line` (1-based), or `undefined` for top-level code. This
 * is what a `Finding` records as its `enclosingSymbol` — the id-stable "where" that survives a patch
 * shifting line numbers. Ties (nested symbols) resolve to the innermost by preferring the smallest
 * containing span.
 */
export function enclosingSymbol(
  symbols: readonly SymbolRef[],
  line: number,
): SymbolRef | undefined {
  let best: SymbolRef | undefined;
  for (const symbol of symbols) {
    const { startLine, endLine } = symbol.location;
    if (line < startLine || line > endLine) continue;
    if (
      best === undefined ||
      endLine - startLine < best.location.endLine - best.location.startLine
    ) {
      best = symbol;
    }
  }
  return best;
}
