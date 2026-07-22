import { readFileSync } from 'node:fs';

import type {
  AnalysisContext,
  AnalysisFile,
  BlockRange,
  WorkspaceCapabilities,
} from './analyzer.js';
import { parseStructure, type FileStructure } from './structure.js';

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

const EMPTY_STRUCTURE: FileStructure = { symbols: [], imports: [], calls: [], blocks: [] };

export function createAnalysisContext(options: CreateContextOptions): AnalysisContext {
  const read = options.readSource ?? readFromDisk;
  // One cache holding the whole parsed structure, so symbols AND blocks come from a single parse per
  // file — no double work when a finding needs both its enclosing symbol and its enclosing block.
  const structureCache = new Map<string, Promise<FileStructure>>();

  const structureFor = (file: AnalysisFile): Promise<FileStructure> => {
    let cached = structureCache.get(file.file);
    if (cached === undefined) {
      cached = (async (): Promise<FileStructure> => {
        const source = read(file.absPath);
        if (source === null) return EMPTY_STRUCTURE;
        return parseStructure(file.language, source, file.file);
      })();
      structureCache.set(file.file, cached);
    }
    return cached;
  };

  return {
    root: options.root,
    capabilities: options.capabilities,
    files: options.files,
    readSource: read,
    symbolsFor: (file) => structureFor(file).then((s) => s.symbols),
    blocksFor: (file): Promise<readonly BlockRange[]> => structureFor(file).then((s) => s.blocks),
  };
}
