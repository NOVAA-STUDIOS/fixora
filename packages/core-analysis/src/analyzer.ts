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
  /**
   * Tools that came from Fixora's own install because the workspace had none (tier 2). A tool in
   * `tools` but also here is a fallback; a tool in `tools` alone is the user's own.
   *
   * Analyzers need the distinction because a bundled tool runs against a workspace that, by
   * definition, has no configuration for it — so it must supply its own, and its findings should be
   * attributed honestly rather than presented as "your linter says".
   */
  readonly bundled?: ReadonlySet<string>;
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
  /**
   * The file's repair scopes — every self-contained statement/declaration/function/class range, from
   * the same cached parse. A repair grounds on the SMALLEST scope containing the finding, so it always
   * targets a syntactically complete, splice-safe unit and never a partial fragment. Optional so a
   * hand-built context (tests) need not provide it.
   */
  scopesFor?(file: AnalysisFile): Promise<readonly RepairScope[]>;
  /**
   * The file's imports, from the same cached parse — the Dependency scope's raw material. Optional for
   * the same reason as `scopesFor`.
   */
  importsFor?(file: AnalysisFile): Promise<readonly ImportRef[]>;
  /**
   * Optional sink for run-level reliability notices (e.g. "ESLint was killed at its 30s timeout;
   * its findings are missing"). The run owner (the analysis worker) supplies it; an external-tool
   * adapter calls it instead of silently returning a misleading "zero findings" for a tool that
   * never finished. Absent in tests/hand-built contexts, so the call site must be optional-call-safe.
   */
  reportNotice?(notice: AnalysisNotice): void;
}

/**
 * A structured, run-level notice an analyzer raises when its external tool did not finish normally —
 * the timeout case (NOV7-01). Deliberately NOT a `Finding`: it has no file/location and no repair,
 * and it must reach the panel as a warning, not as a defect in the user's code.
 */
export interface AnalysisNotice {
  /** The analyzer id that raised it, e.g. `eslint`. */
  readonly analyzerId: string;
  /** The external tool that was killed, e.g. `eslint`. */
  readonly tool: string;
  /** The hard ceiling the tool was killed past, in milliseconds. */
  readonly timeoutMs: number;
  /** A user-facing message explaining that this part of the analysis is missing. */
  readonly message: string;
}

/** An import as the Dependency-scope selector needs it: the module and where its statement sits. */
export interface ImportRef {
  readonly module: string;
  readonly location: { readonly startLine: number; readonly endLine: number };
}

/** Where a repair scope sits in the Token→…→Module hierarchy (Repair Context Engine v2). */
export type RepairScopeLevel = 'statement' | 'declaration' | 'function' | 'class' | 'module';

/** A self-contained AST scope (1-based, inclusive) that parses independently and splices safely. */
export interface RepairScope {
  readonly startLine: number;
  readonly endLine: number;
  readonly level: RepairScopeLevel;
}

export interface Analyzer {
  /** Stable id, also the cache namespace for this analyzer's findings. */
  readonly id: string;
  /** Is this analyzer active in this workspace at all? (Is its tool present?) Language filtering is
   *  per-file inside `run()`. */
  supports(capabilities: WorkspaceCapabilities): boolean;
  /**
   * True when this analyzer's findings for a file depend on nothing but that file's own bytes.
   *
   * The engine will then reuse findings for unchanged files across runs. Declaring it on an analyzer
   * that reads OTHER files — a type checker, a linter with type-aware rules — would make it report a
   * file as clean after a change elsewhere broke it. Absent means "not safe to cache", which is the
   * right default for anything cross-file.
   */
  readonly fileLocal?: boolean;
  /**
   * Produce findings for the whole workspace, streaming so the panel fills as results arrive. Must
   * observe `signal` (kill the subprocess / stop iterating on abort) and must never throw for an
   * ordinary "tool found nothing" — that is an empty stream, not an error.
   */
  run(context: AnalysisContext, signal: AbortSignal): AsyncIterable<Finding>;
}
