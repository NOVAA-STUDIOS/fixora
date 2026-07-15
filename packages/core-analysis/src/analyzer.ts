import type { Finding, Language } from '@fixora/shared-types';

/**
 * The analyzer contract (TDD §5.2). Every source of findings — tree-sitter-based (complexity) and
 * external-tool-based (ESLint, tsc, ruff, mypy, go vet, Semgrep) — implements this one interface, so
 * the engine drives them uniformly and the normalisation to `Finding` happens in exactly one place
 * per tool. Adding a language or a tool is adding an `Analyzer`, never touching the engine.
 */

/** One file to analyze, with everything an adapter might need — content in memory and on disk. */
export interface AnalysisTarget {
  /** Workspace-relative POSIX path — what a `Finding.location.file` reports. */
  readonly file: string;
  /** Absolute path on disk — for tools that must be pointed at a real file. */
  readonly absPath: string;
  readonly language: Language;
  /** The file's current content (may differ from disk if there are unsaved edits). */
  readonly source: string;
  /** The trusted workspace root — an adapter runs the tool with this as cwd (config discovery). */
  readonly workspaceRoot: string;
}

/**
 * Which tools this workspace actually has (TDD §5.2). Adapters consult this in `supports()` so we run
 * **the workspace's own tooling**, never a bundled copy that would argue with the user's CI (ADR-007).
 * When a tool is absent we degrade to tree-sitter-only analysis for that language and say so.
 */
export interface WorkspaceCapabilities {
  readonly root: string;
  /** Tool ids detected as available (e.g. `'eslint'`, `'tsc'`, `'ruff'`, `'go'`, `'semgrep'`). */
  readonly tools: ReadonlySet<string>;
  /** Tool version strings, when known — part of the incremental cache key (`content+version+config`). */
  readonly versions: ReadonlyMap<string, string>;
}

export interface Analyzer {
  /** Stable id, also the cache namespace for this analyzer's findings. */
  readonly id: string;
  /** Does this analyzer apply to this language in THIS workspace? (Is its tool present?) */
  supports(language: Language, workspace: WorkspaceCapabilities): boolean;
  /**
   * Produce findings for one target, streaming so the panel fills as results arrive. Must observe
   * `signal`: on abort, stop promptly (kill the subprocess, stop walking the tree). Must never throw
   * for an ordinary "tool found nothing" — that is an empty stream, not an error.
   */
  analyze(target: AnalysisTarget, signal: AbortSignal): AsyncIterable<Finding>;
}
