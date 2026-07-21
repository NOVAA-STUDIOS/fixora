import type {
  Autofix,
  Category,
  Finding,
  FindingSource,
  Severity,
  SymbolRef,
} from '@fixora/shared-types';

import type { AnalysisContext } from '../analyzer.js';
import { findingId } from '../finding-id.js';
import type { ToolRunner } from '../process/run-tool.js';
import { classifyRepair } from '../repair/micro-repair.js';
import { enclosingSymbol } from '../symbols/symbols.js';
import type { ResolvedTool } from '../tools/resolve.js';

/**
 * Shared normalisation for the external-tool adapters. Each adapter runs its tool **once** over the
 * workspace, parses the output into `RawFinding`s grouped by file, then hands them here to be
 * grounded — enclosing symbol, source snippet, stable id — so that grounding logic lives in exactly
 * one place. Symbols come from the shared per-run cache (`context.symbolsFor`), so a file is parsed
 * once no matter how many tools report findings in it.
 */

/** The injectable seams an external-tool adapter shares, overridden in tests. */
export interface AdapterDeps {
  runner?: ToolRunner;
  resolveTool?: (root: string) => ResolvedTool | null;
}

/** A finding reduced to what an adapter parses from tool output, before grounding. */
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
  /** The tool's own edit, when it emitted one. Carried through grounding onto the Finding. */
  autofix?: Autofix;
  toolOutput: unknown;
}

export interface FileGrounder {
  ground(raw: RawFinding): Finding;
}

/** Ground the findings of one file: `text` is its source, `symbols` its parsed structure. */
export function createFileGrounder(
  source: FindingSource,
  file: string,
  text: string,
  symbols: readonly SymbolRef[],
): FileGrounder {
  const lines = text.split(/\r?\n/);
  return {
    ground(raw: RawFinding): Finding {
      const symbol = enclosingSymbol(symbols, raw.startLine);
      const snippet = lines[raw.startLine - 1] ?? '';
      const finding: Finding = {
        id: findingId({ source, ruleId: raw.ruleId, file, enclosingSymbol: symbol, snippet }),
        source,
        ruleId: raw.ruleId,
        severity: raw.severity,
        category: raw.category,
        location: {
          file,
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
        ...(raw.autofix !== undefined ? { autofix: raw.autofix } : {}),
        // Placeholder; overwritten below once the finding exists (classifyRepair reads autofix+ruleId).
        repair: 'ai-required',
        confidence: 1,
      };
      // Every finding carries its repairability (M6 Goal 5). Derived from the tool's own autofix and
      // the rule, so a fix a tool shipped reads as `safe-auto` and an unknowable-intent rule as `manual`.
      finding.repair = classifyRepair(finding);
      return finding;
    },
  };
}

/**
 * Ground raw findings grouped by workspace-relative file and stream the results. Findings for a file
 * the run did not enumerate (a config file the tool linted, say) are dropped — we only report on the
 * vetted set. Each reported file is parsed once via the shared symbol cache.
 */
export async function* groundByFile(
  source: FindingSource,
  context: AnalysisContext,
  byFile: ReadonlyMap<string, RawFinding[]>,
  signal: AbortSignal,
): AsyncIterable<Finding> {
  const filesByRel = new Map(context.files.map((f) => [f.file, f] as const));
  for (const [file, raws] of byFile) {
    if (signal.aborted) return;
    const analysisFile = filesByRel.get(file);
    if (analysisFile === undefined) continue;
    const symbols = await context.symbolsFor(analysisFile);
    const grounder = createFileGrounder(
      source,
      file,
      context.readSource(analysisFile.absPath) ?? '',
      symbols,
    );
    for (const raw of raws) yield grounder.ground(raw);
  }
}
