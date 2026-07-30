import type {
  Autofix,
  Category,
  Finding,
  FindingSource,
  Location,
  Severity,
  SymbolRef,
} from '@fixora/shared-types';

import type { AnalysisContext, ImportRef, RepairScope } from '../analyzer.js';
import { findingId } from '../finding-id.js';
import type { ToolRunner } from '../process/run-tool.js';
import { isDelimiterRule, outermostScopeContaining } from '../repair/balanced-scope.js';
import { selectRepairContext } from '../repair/context-selector.js';
import { classifyRepair } from '../repair/micro-repair.js';
import { smallestScopeContaining } from '../repair/scope-selector.js';
import {
  buildRenameAutofix,
  importedNames,
  isUndefinedNameRule,
  resolveUndefinedName,
  toCandidates,
  type CandidateSources,
  type SymbolCandidate,
} from '../repair/symbol-resolution.js';
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

/**
 * Project-wide symbols for undefined-name resolution, gathered lazily.
 *
 * A thunk rather than an array because the project index is the expensive source: it is only ever
 * consulted for a TS2304/F821 finding whose own file and imports came up empty, which on most runs is
 * never. Passing the work rather than the result keeps that cost unpaid until it is needed.
 */
export type ProjectSymbols = () => readonly SymbolCandidate[];

/** Ground the findings of one file: `text` is its source, `symbols`/`scopes` its parsed structure. */
export function createFileGrounder(
  source: FindingSource,
  file: string,
  text: string,
  symbols: readonly SymbolRef[],
  scopes: readonly RepairScope[] = [],
  imports: readonly ImportRef[] = [],
  projectSymbols: ProjectSymbols = () => [],
): FileGrounder {
  const lines = text.split(/\r?\n/);

  /** The widening scopes an undefined identifier is resolved against, nearest first. */
  const candidateSources: CandidateSources = {
    sameFile: () => toCandidates(symbols, 'same-file'),
    imports: () => {
      const names: SymbolCandidate[] = [];
      for (const ref of imports) {
        // The statement's own text is the authority on what it binds locally.
        const statement = lines.slice(ref.location.startLine - 1, ref.location.endLine).join('\n');
        for (const name of importedNames(statement)) names.push({ name, origin: 'import' });
      }
      return names;
    },
    project: projectSymbols,
  };
  return {
    ground(raw: RawFinding): Finding {
      const symbol = enclosingSymbol(symbols, raw.startLine);
      // The repair scope: the SMALLEST self-contained statement/declaration that contains the finding
      // (Repair Context Engine v2). It always parses independently and splices safely, and it is the
      // tightest such region — so a repair targets the least code that still compiles, never a partial
      // fragment (the object-literal TS2322 that the parser rejected) and never the whole function for
      // a one-line fix.
      /**
       * Root Cause B2, and ONLY for delimiter-class rules.
       *
       * A finding whose defect is an unbalanced delimiter is reported where the parser gave up, not
       * where the structure broke, so the smallest containing scope excludes the defect and no patch
       * within it can make the file parse. For that class — and no other — the target widens to the
       * outermost construct containing the line, which is the one whose delimiter is missing.
       *
       * Every other finding keeps the smallest scope: it already contains its own defect, and a wider
       * range would only enlarge what a wrong patch can damage.
       */
      const scope = isDelimiterRule(raw.ruleId)
        ? (outermostScopeContaining(scopes, raw.startLine) ??
          smallestScopeContaining(scopes, raw.startLine))
        : smallestScopeContaining(scopes, raw.startLine);
      // The Semantic + Dependency scope (v3): the imports and declarations THIS scope references, so
      // the repair prompt carries what the code refers to. Only computed when a scope was resolved.
      const contextRanges =
        scope !== null
          ? selectRepairContext({
              source: text,
              scopeStartLine: scope.startLine,
              scopeEndLine: scope.endLine,
              symbols,
              imports,
              targetSymbolName: symbol?.name ?? null,
            })
          : [];
      const snippet = lines[raw.startLine - 1] ?? '';

      /**
       * Context-aware resolution for an undefined identifier (TS2304/F821). Two outputs, and both
       * matter: the candidate declaration sites become the finding's related locations — which is
       * simultaneously useful evidence for the user and the signal `classifyRepair` reads to decide
       * this is repairable at all — and a single overwhelmingly likely candidate also produces a
       * deterministic rename edit, so the fix needs no model.
       */
      let resolvedAutofix: Autofix | undefined;
      let relatedLocations: Location[] = [];
      if (isUndefinedNameRule(raw.ruleId)) {
        const resolution = resolveUndefinedName(
          { ruleId: raw.ruleId, message: raw.message },
          candidateSources,
        );
        relatedLocations = resolution.candidates.flatMap((candidate) =>
          candidate.location !== undefined ? [candidate.location] : [],
        );
        if (
          resolution.outcome === 'resolved' &&
          resolution.best !== null &&
          resolution.name !== null
        ) {
          const edit = buildRenameAutofix(text, resolution.name, resolution.best.name, {
            startLine: raw.startLine,
            startCol: raw.startCol,
          });
          // No edit means the identifier could not be located byte-for-byte. The candidates still
          // stand, so the finding stays repairable — just via the verified AI path, not silently here.
          if (edit !== null) resolvedAutofix = { source, edits: [edit] };
        }
      }

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
          ...(scope !== null
            ? { enclosingRange: { startLine: scope.startLine, endLine: scope.endLine } }
            : {}),
          ...(contextRanges.length > 0 ? { contextRanges } : {}),
          snippet,
          relatedLocations,
          toolOutput: raw.toolOutput,
        },
        // A resolved rename IS a fix, so the badge must say so — the tool did not author it, but the
        // engine did, deterministically, and the user can apply it without a model.
        fixable: raw.fixable || resolvedAutofix !== undefined,
        // The tool's own fix always wins: it is AST-based and semantics-preserving by construction,
        // where ours is a lexical rename. Ours only fills the gap where the tool offered nothing.
        ...(raw.autofix !== undefined
          ? { autofix: raw.autofix }
          : resolvedAutofix !== undefined
            ? { autofix: resolvedAutofix }
            : {}),
        // Placeholder; overwritten below once the finding exists (classifyRepair reads autofix+ruleId).
        repair: 'ai-required',
        confidence: 1,
      };
      // Every finding carries its repairability (M6 Goal 5). Derived from the tool's own autofix, the
      // resolver's evidence, and the rule — so a shipped fix reads `safe-auto`, an undefined name with
      // candidates in scope reads `ai-required`, and one with nothing in scope stays `manual`.
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

  /**
   * The project-wide symbol index for undefined-name resolution, built at most once per run and only
   * when this run actually contains a TS2304/F821 finding.
   *
   * Gated on that check rather than built eagerly because it walks every file's symbols: on the common
   * run — no undefined names anywhere — the cost is a single scan of the raw findings and nothing else.
   * The per-file parses it does need are already shared through `context.symbolsFor`'s cache, so this
   * re-uses whatever the other analyzers in the same run have paid for.
   */
  const needsProjectIndex = [...byFile.values()].some((raws) =>
    raws.some((raw) => isUndefinedNameRule(raw.ruleId)),
  );
  let projectIndex: readonly SymbolCandidate[] | null = null;
  const projectSymbolsFor = async (ownFile: string): Promise<ProjectSymbols> => {
    if (!needsProjectIndex) return () => [];
    if (projectIndex === null) {
      const gathered: SymbolCandidate[] = [];
      for (const candidateFile of context.files) {
        if (signal.aborted) break;
        for (const symbol of await context.symbolsFor(candidateFile)) {
          gathered.push({ name: symbol.name, origin: 'project', location: symbol.location });
        }
      }
      projectIndex = gathered;
    }
    // The finding's own file is already covered by the nearer `sameFile` source; including it here
    // would double-count it and could turn a single clear winner into a false tie.
    const index = projectIndex;
    return () => index.filter((candidate) => candidate.location?.file !== ownFile);
  };

  for (const [file, raws] of byFile) {
    if (signal.aborted) return;
    const analysisFile = filesByRel.get(file);
    if (analysisFile === undefined) continue;
    const symbols = await context.symbolsFor(analysisFile);
    // Repair scopes and imports come from the same cached parse. A hand-built context may omit them,
    // in which case findings simply carry no enclosingRange/contextRanges (the old behaviour).
    const scopes = context.scopesFor ? await context.scopesFor(analysisFile) : [];
    const imports = context.importsFor ? await context.importsFor(analysisFile) : [];
    const grounder = createFileGrounder(
      source,
      file,
      context.readSource(analysisFile.absPath) ?? '',
      symbols,
      scopes,
      imports,
      await projectSymbolsFor(file),
    );
    for (const raw of raws) yield grounder.ground(raw);
  }
}
