import { readFileSync } from 'node:fs';

import type { SymbolRef } from '@fixora/shared-types';

import type { AnalysisContext, AnalysisFile, WorkspaceCapabilities } from './analyzer.js';
import { parseStructure } from './structure.js';

/**
 * Build the per-run analysis context. `symbolsFor` parses a file's structure once and caches it, so
 * every analyzer grounds against the same symbols without re-parsing; `readSource` defaults to disk
 * but is overridable (tests, or in-memory unsaved content later).
 */
export interface CreateContextOptions {
  root: string;
  capabilities: WorkspaceCapabilities;
  files: readonly AnalysisFile[];
  readSource?: (absPath: string) => string | null;
}

function readFromDisk(absPath: string): string | null {
  try {
    return readFileSync(absPath, 'utf8');
  } catch {
    return null;
  }
}

export function createAnalysisContext(options: CreateContextOptions): AnalysisContext {
  const read = options.readSource ?? readFromDisk;
  const symbolCache = new Map<string, Promise<readonly SymbolRef[]>>();

  return {
    root: options.root,
    capabilities: options.capabilities,
    files: options.files,
    readSource: read,
    symbolsFor(file: AnalysisFile): Promise<readonly SymbolRef[]> {
      let cached = symbolCache.get(file.file);
      if (cached === undefined) {
        cached = (async (): Promise<readonly SymbolRef[]> => {
          const source = read(file.absPath);
          if (source === null) return [];
          const { symbols } = await parseStructure(file.language, source, file.file);
          return symbols;
        })();
        symbolCache.set(file.file, cached);
      }
      return cached;
    },
  };
}
