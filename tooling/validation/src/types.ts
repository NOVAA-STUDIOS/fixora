import type { RepairStrategy } from '@fixora/core-analysis';
import type { Language, Severity } from '@fixora/shared-types';

/**
 * The measured record schema for the Real Repository Validation Harness (P1.1).
 *
 * The harness runs the REAL engine over real-shaped projects and records, for every finding, exactly
 * what happened at every stage of Analyze → Repair → Verify → Apply → Re-analyze → Compile. Nothing is
 * estimated. A stage that cannot run (no provider key, no compiler, no autofix) says so precisely; it
 * is never scored as a pass. Every failure carries the exact subsystem and the exact reason so it is
 * reproducible from the record alone.
 */

/** The pipeline stage a result was decided at. Ordered as the pipeline runs. */
export type Stage =
  | 'analyze'
  | 'eligibility'
  | 'repair'
  | 'verify-parse'
  | 'verify-format'
  | 'reanalyze'
  | 'regression'
  | 'apply'
  | 'compile';

/**
 * The exact subsystem that produced an outcome — the P0 vocabulary, so a failure is attributable to a
 * component, never to "something went wrong".
 */
export type Subsystem =
  | 'analyzer'
  | 'eligibility-engine'
  | 'scope-selector'
  | 'context-builder'
  | 'prompt-builder'
  | 'ai-provider'
  | 'response-parser'
  | 'patch-extractor'
  | 'ast-verifier'
  | 'formatter'
  | 'regression-verifier'
  | 'apply-engine'
  | 'compile-runner'
  | 'none';

/**
 * The single terminal outcome of a repair attempt. Exactly one is recorded — the P0 Phase-7 enum,
 * extended with AI_DEFERRED for the (measured) reality that no provider key is present. Nothing else.
 */
export type FinalOutcome =
  | 'SAFE_AUTO_REPAIR_APPLIED'
  | 'AI_REPAIR_APPLIED'
  | 'AI_GENERATE_FAILED'
  | 'MANUAL_FIX_REQUIRED'
  | 'AI_DEFERRED'
  | 'UNSUPPORTED_LANGUAGE'
  | 'UNSUPPORTED_RULE'
  | 'VERIFICATION_FAILED'
  | 'REGRESSION_DETECTED'
  | 'APPLY_FAILED';

/** A per-stage result: whether it ran, whether it passed, and — when it did not — the exact reason. */
export interface StageResult {
  ran: boolean;
  ok: boolean;
  detail: string;
}

/** The full measured record for one finding's repair attempt. */
export interface AttemptRecord {
  language: Language;
  project: string;
  file: string;
  ruleId: string;
  source: string;
  severity: Severity;
  /** How the engine classified repairability BEFORE any attempt (the eligibility decision). */
  repairability: RepairStrategy;
  /** The stage the attempt terminated at. */
  stage: Stage;
  /** The subsystem that owns that terminal stage. `none` for a clean pass. */
  subsystem: Subsystem;
  /** Machine-readable reason for the terminal state. Never generic. */
  rootCause: string;
  /** Wall-clock time for the whole attempt, ms (analysis is amortised per file, not per finding). */
  runtimeMs: number;
  repair: StageResult;
  verification: StageResult;
  apply: StageResult;
  reanalysis: StageResult;
  compile: StageResult;
  finalOutcome: FinalOutcome;
  /**
   * Diagnostic evidence for an AI attempt — the model's replacement and the target it was spliced
   * into. Present only for AI attempts, so a failure is reproducible from the record alone (the exact
   * text the model produced, not a summary). Never contains a key; the model output is not a secret.
   */
  aiDiagnostic?: {
    targetStartLine: number;
    targetEndLine: number;
    repairedCode: string;
  };
}

/** The result of validating one project: its per-file analysis plus every repair attempt. */
export interface ProjectResult {
  project: string;
  /** The project's DECLARED language (manifest label, for roll-up) — includes css/html, which are
   *  not engine `Language`s. Per-finding language on an AttemptRecord is the real analyzed language. */
  language: string;
  root: string;
  filesAnalyzed: number;
  findings: number;
  /** ms to analyze the whole project once (shared across its findings). */
  analyzeMs: number;
  /** The project's baseline compile/test result before any repair, or null when no command is set. */
  baselineCompile: StageResult | null;
  attempts: AttemptRecord[];
  /** A project-level error (discovery/analysis crashed) — the project itself failed, not a finding. */
  error?: string;
}

export interface RunResult {
  ranAt: string;
  providerKeyPresent: boolean;
  projects: ProjectResult[];
}
