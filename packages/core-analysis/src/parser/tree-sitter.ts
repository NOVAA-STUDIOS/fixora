import { readFileSync } from 'node:fs';

import type { Language } from '@fixora/shared-types';
import { Language as TSLanguage, type Node, Parser } from 'web-tree-sitter';

import { coreWasmPath, grammarWasmPath } from './grammar-paths.js';

/**
 * The tree-sitter runtime, wrapped so the rest of the engine never touches the WASM lifecycle. The
 * core runtime is initialised once; each grammar is loaded once and cached. Parsing is synchronous
 * after that, which is what lets symbol extraction be a plain function over a `ParsedTree`.
 *
 * Trees hold WASM memory that the GC does not reclaim — so a `ParsedTree` owns a `dispose()` the
 * caller must invoke once it has read what it needs. Extraction turns the tree into plain data
 * (`SymbolRef[]`, positions as numbers) precisely so nothing downstream holds a WASM reference.
 */

let initPromise: Promise<void> | undefined;
function ensureRuntime(): Promise<void> {
  initPromise ??= Parser.init({ locateFile: () => coreWasmPath() });
  return initPromise;
}

const languageCache = new Map<Language, Promise<TSLanguage>>();
function loadLanguage(language: Language): Promise<TSLanguage> {
  let cached = languageCache.get(language);
  if (cached === undefined) {
    cached = (async (): Promise<TSLanguage> => {
      await ensureRuntime();
      return TSLanguage.load(readFileSync(grammarWasmPath(language)));
    })();
    languageCache.set(language, cached);
  }
  return cached;
}

export interface ParsedTree {
  /** The syntax tree root. Valid only until `dispose()` is called. */
  readonly root: Node;
  /** The loaded grammar — needed to compile a `Query` against this tree. */
  readonly grammar: TSLanguage;
  /** Release the WASM tree + parser. Must be called once extraction is done. */
  dispose(): void;
}

/** Parse source in the given language. The caller owns the returned tree and must `dispose()` it. */
export async function parse(language: Language, source: string): Promise<ParsedTree> {
  const grammar = await loadLanguage(language);
  const parser = new Parser();
  parser.setLanguage(grammar);
  const tree = parser.parse(source);
  if (tree === null) {
    parser.delete();
    throw new Error(`tree-sitter failed to parse ${language} source`);
  }
  return {
    root: tree.rootNode,
    grammar,
    dispose: () => {
      tree.delete();
      parser.delete();
    },
  };
}
