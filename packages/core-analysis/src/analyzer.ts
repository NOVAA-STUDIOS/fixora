import type { Finding, Language, SymbolRef } from '@fixora/shared-types';

/**
 * The analyzer contract (TDD §5.2). Every source of findings — tree-sitter-based (complexity) and
 * external-tool-based (ESLint, tsc, ruff, mypy, go vet, Semgrep) — implements this one interface.
 *
 * Analyzers are **workspace-scoped**: each `run()` is invoked once per analysis, over the whole set
 * of files, and streams findings for any of them. This is the load-bearing performance decision — an
 * external tool is spawned **once** (`eslint .`, `tsc --noEmit`, `go vet ./...`), not once per file,
 * so a real repo analyzes in seconds instead of re-running the whole type-checker N times. Per-file
 * work that genuinely is per-file (tree-sitter parsing for complexity) the analyzer does by iterating
 * `context.files` itself.
 */

/** One analyzable file: a language we support, vetted by main (path guard + secrets + ignore). */
export interface AnalysisFile {
  /** Workspace-relative POSIX path — what a `Finding.location.file` reports. */
  readonly file: string;
  /** Absolute path on disk. */
  readonly absPath: string;
  readonly language: Language;
}

/**
 * Which tools this workspace actually has (TDD §5.2, ADR-007). Adapters consult this so we run **the
 * workspace's own tooling**, never a bundled copy that would argue with the user's CI. When a tool is
 * absent we degrade to tree-sitter-only analysis and say so.
 */
export interface WorkspaceCapabilities {
  readonly root: string;
  readonly tools: ReadonlySet<string>;
  readonly versions: ReadonlyMap<string, string>;
}

/**
 * Everything an analyzer needs for one workspace run. `symbolsFor` is a **shared, lazy, cached**
 * tree-sitter parse: complexity, ESLint, tsc and the rest all ground their findings against the same
 * per-file symbol list without re-parsing.
 */
export interface AnalysisContext {
  readonly root: string;
  readonly capabilities: WorkspaceCapabilities;
  readonly files: readonly AnalysisFile[];
  /** Current content of a file, or null if unreadable. */
  readSource(absPath: string): string | null;
  /** The file's symbols (functions/classes/…), parsed once and cached across analyzers. */
  symbolsFor(file: AnalysisFile): Promise<readonly SymbolRef[]>;
}

export interface Analyzer {
  /** Stable id, also the cache namespace for this analyzer's findings. */
  readonly id: string;
  /** Is this analyzer active in this workspace at all? (Is its tool present?) Language filtering is
   *  per-file inside `run()`. */
  supports(capabilities: WorkspaceCapabilities): boolean;
  /**
   * Produce findings for the whole workspace, streaming so the panel fills as results arrive. Must
   * observe `signal` (kill the subprocess / stop iterating on abort) and must never throw for an
   * ordinary "tool found nothing" — that is an empty stream, not an error.
   */
  run(context: AnalysisContext, signal: AbortSignal): AsyncIterable<Finding>;
}
