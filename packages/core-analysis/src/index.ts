export { findingId, normalizeSnippet, type FindingIdInput } from './finding-id.js';
export { dedupeFindings, type DedupResult } from './dedup.js';
export {
  isRelativeSpecifier,
  resolveRelativeImport,
  selectCrossFileContext,
  type CrossFileContext,
} from './repair/cross-file-context.js';
export type { Analyzer, AnalysisContext, AnalysisFile, AnalysisNotice, WorkspaceCapabilities } from './analyzer.js';
export { createAnalysisContext, type CreateContextOptions } from './context.js';
export { complexityAnalyzer } from './analyzers/complexity.js';
export { createEslintAnalyzer } from './analyzers/eslint.js';
export { createJsonAnalyzer } from './analyzers/json.js';
export { createSyntaxAnalyzer, isTailwindDirectiveLine } from './analyzers/syntax.js';
export { createRuffAnalyzer } from './analyzers/ruff.js';
export { createGoVetAnalyzer } from './analyzers/go-vet.js';
export { createTscAnalyzer } from './analyzers/tsc.js';
export { createSemgrepAnalyzer, hasSemgrepConfig } from './analyzers/semgrep.js';
export { createMypyAnalyzer } from './analyzers/mypy.js';
export {
  createFileGrounder,
  groundByFile,
  type AdapterDeps,
  type FileGrounder,
  type RawFinding,
} from './analyzers/support.js';
export { analyzeWorkspace, type AnalyzeWorkspaceOptions } from './engine.js';
export {
  createFindingCache,
  hashSource,
  type CacheSplit,
  type FindingCache,
} from './finding-cache.js';
export { applicableAnalyzers, defaultAnalyzers } from './registry.js';
export { detectCapabilities } from './capabilities.js';
export { runTool, type RunToolOptions, type ToolRun, type ToolRunner } from './process/run-tool.js';
export { resolveNodeTool, resolvePathTool, which, type ResolvedTool } from './tools/resolve.js';
export { languageForPath } from './language.js';
export { resolveEditScope, type EditScope, type ResolveScopeInput } from './edit/scope.js';
export { parseStructure, type FileStructure } from './structure.js';
export { parse, type ParsedTree } from './parser/tree-sitter.js';
export {
  applyEdits,
  classifyRepair,
  deterministicRepair,
  type MicroRepairResult,
  type RepairStrategy,
} from './repair/micro-repair.js';
export { formatGate, resolveFormatter, type FormatGateResult } from './repair/format-gate.js';
export {
  groupByRootCause,
  scopeRangeOf,
  type RootCauseGroup,
  type ScopeRange,
} from './repair/root-cause-grouping.js';

export { widenRepairScope, type WidenInput } from './repair/scope-escalation.js';
export type { RepairScope, RepairScopeLevel } from './analyzer.js';
export {
  selectRepairContext,
  type ContextRange,
  type ImportLike,
} from './repair/context-selector.js';
export {
  enclosingSymbol,
  extractCalls,
  extractImports,
  extractSymbols,
  type CallEdge,
  type ExtractedImport,
} from './symbols/symbols.js';
