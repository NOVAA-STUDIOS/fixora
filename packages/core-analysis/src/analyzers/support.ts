import type { Category, Finding, FindingSource, Severity, SymbolRef } from '@fixora/shared-types';

import type { AnalysisTarget } from '../analyzer.js';
import { findingId } from '../finding-id.js';
import type { ToolRunner } from '../process/run-tool.js';
import { enclosingSymbol } from '../symbols/symbols.js';
import type { ResolvedTool } from '../tools/resolve.js';

/**
 * The injectable seams every external-tool adapter shares. `runner` runs the subprocess; `resolveTool`
 * locates the tool for a target. Both have real defaults in production and are overridden in tests so
 * an adapter's normalisation is exercised with canned output and a fake tool, no real binary required.
 */
export interface AdapterDeps {
  runner?: ToolRunner;
  resolveTool?: (target: AnalysisTarget) => ResolvedTool | null;
}

/**
 * Shared normalisation for the external-tool adapters. Each adapter's real work is turning its tool's
 * output into `RawFinding`s (the tool-specific parsing); this turns those into grounded `Finding`s —
 * resolving the enclosing symbol, lifting the source snippet, and computing the stable id — so that
 * grounding logic lives in exactly one place rather than being copy-pasted (and drifting) per tool.
 */

/** A finding reduced to what an adapter can produce from tool output, before grounding. */
export interface RawFinding {
  ruleId: string;
  severity: Severity;
  category: Category;
  message: string;
  startLine: number;
  startCol: number;
  endLine?: number;
  endCol?: number;
  fixable: boolean;
  /** The raw tool payload, kept for debugging and the golden corpus. */
  toolOutput: unknown;
}

export interface Grounder {
  /** Turn one raw finding into a grounded `Finding`. */
  ground(raw: RawFinding): Finding;
}

/**
 * Build a grounder for a file: it parses the source into lines once and reuses the symbol list, so
 * grounding N findings in a file is one symbol pass, not N. `symbols` come from `parseStructure`.
 */
export function createGrounder(
  source: FindingSource,
  target: AnalysisTarget,
  symbols: readonly SymbolRef[],
): Grounder {
  const lines = target.source.split(/\r?\n/);
  return {
    ground(raw: RawFinding): Finding {
      const symbol = enclosingSymbol(symbols, raw.startLine);
      const snippet = lines[raw.startLine - 1] ?? '';
      return {
        id: findingId({
          source,
          ruleId: raw.ruleId,
          file: target.file,
          enclosingSymbol: symbol,
          snippet,
        }),
        source,
        ruleId: raw.ruleId,
        severity: raw.severity,
        category: raw.category,
        location: {
          file: target.file,
          startLine: raw.startLine,
          startCol: raw.startCol,
          endLine: raw.endLine ?? raw.startLine,
          endCol: raw.endCol ?? raw.startCol,
        },
        message: raw.message,
        evidence: {
          ...(symbol !== undefined ? { enclosingSymbol: symbol } : {}),
          snippet,
          relatedLocations: [],
          toolOutput: raw.toolOutput,
        },
        fixable: raw.fixable,
        confidence: 1,
      };
    },
  };
}
