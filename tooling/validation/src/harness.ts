import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';

import type { AIProvider } from '@fixora/core-ai';
import {
  analyzeWorkspace,
  createAnalysisContext,
  deterministicRepair,
  formatGate,
  languageForPath,
  parse,
  type AnalysisFile,
  type WorkspaceCapabilities,
} from '@fixora/core-analysis';
import type { Finding, Language } from '@fixora/shared-types';

import { compileProject } from './compile.js';
import { generateRepair } from './generate.js';
import { collectFiles, type DiscoveredProject } from './projects.js';
import type {
  AttemptRecord,
  FinalOutcome,
  ProjectResult,
  Stage,
  StageResult,
  Subsystem,
} from './types.js';

/**
 * The Real Repository Validation Harness (P1.1).
 *
 * Runs the REAL engine over a project and, for every finding, drives Analyze → Repair → Verify →
 * Apply → Re-analyze → Compile on a throwaway overlay so the corpus on disk is never touched. Every
 * stage produces a measured result or an exact "did not run" reason. A deterministic (tool-authored)
 * repair is executed for real; an AI-required repair is DEFERRED (no provider key — never faked); a
 * manual finding is classified, never patched.
 */

const NOT_RUN = (detail: string): StageResult => ({ ran: false, ok: false, detail });
const PASS = (detail: string): StageResult => ({ ran: true, ok: true, detail });
const FAIL = (detail: string): StageResult => ({ ran: true, ok: false, detail });

export async function analyze(
  root: string,
  files: AnalysisFile[],
  capabilities: WorkspaceCapabilities,
): Promise<Finding[]> {
  const context = createAnalysisContext({ root, capabilities, files });
  const findings: Finding[] = [];
  for await (const f of analyzeWorkspace({ context }, new AbortController().signal)) {
    findings.push(f);
  }
  return findings;
}

function blankStages(): Pick<
  AttemptRecord,
  'repair' | 'verification' | 'apply' | 'reanalysis' | 'compile'
> {
  const none = NOT_RUN('not reached');
  return {
    repair: none,
    verification: none,
    apply: none,
    reanalysis: none,
    compile: none,
  };
}

export interface Terminal {
  stage: Stage;
  subsystem: Subsystem;
  rootCause: string;
  finalOutcome: FinalOutcome;
}

export interface GateInput {
  project: DiscoveredProject;
  /** The workspace-relative file being patched. */
  file: string;
  /** The finding being repaired, or `null` for a Proceed EDIT (verify regression-only, no target). */
  finding: Finding | null;
  language: Language;
  /** The full file content after the repair (deterministic splice or AI splice). */
  patched: string;
  /** The already-formed repair-stage result (edits applied, or model generated). */
  repairStage: StageResult;
  /** The terminal outcome to record when every gate passes. */
  successOutcome: FinalOutcome;
  beforeIds: Set<string>;
  capabilities: WorkspaceCapabilities;
  baselineCompileOk: boolean | null;
  toolRoot: string;
}

/**
 * The shared gate pipeline every repair — deterministic OR AI — must survive, run on a fresh overlay:
 * parser gate → formatter gate → re-analyze (regression + target-cleared) → apply round-trip →
 * compile. Identical treatment is the point: an AI patch is held to exactly the same bar as a
 * tool autofix, so no repair source can bypass verification. The overlay is always disposed.
 */
export async function runGates(
  input: GateInput,
): Promise<{ stages: ReturnType<typeof blankStages>; terminal: Terminal }> {
  const { project, finding, language, patched, file } = input;
  const stages = blankStages();
  stages.repair = input.repairStage;

  // --- Verify: parser gate (the patched file must parse under its own grammar) ---
  let parseOk: boolean;
  try {
    const tree = await parse(language, patched, file);
    parseOk = !tree.root.hasError;
    tree.dispose();
  } catch {
    parseOk = false;
  }
  if (!parseOk) {
    stages.verification = FAIL('patched file does not parse under its own grammar');
    return {
      stages,
      terminal: {
        stage: 'verify-parse',
        subsystem: 'ast-verifier',
        rootCause: 'the parser gate rejected the patched file (would break the file)',
        finalOutcome: 'VERIFICATION_FAILED',
      },
    };
  }

  // The overlay is scaffolding for the file-based gates (formatter, re-analyze). Writing to it is NOT
  // yet "apply success" — apply is marked only once every gate that governs the real apply has passed.
  const overlay = mkdtempSync(join(tmpdir(), 'fx-val-'));
  try {
    cpSync(project.dir, overlay, {
      recursive: true,
      filter: (src) =>
        !src.endsWith('validation.json') &&
        !src.includes(`${sep}node_modules${sep}`) &&
        !src.includes(`${sep}__pycache__${sep}`),
    });
    const absOverlay = join(overlay, file);
    writeFileSync(absOverlay, patched, 'utf8');

    // --- Verify: formatter gate (only where a formatter exists; honestly absent otherwise) ---
    const fmt = await formatGate({ root: overlay, absFile: absOverlay, language });
    if (fmt.ran && !fmt.ok) {
      stages.verification = FAIL(
        `formatter rejected the patch: ${fmt.message ?? fmt.formatter ?? 'unknown'}`,
      );
      stages.apply = NOT_RUN('blocked: formatter gate failed');
      return {
        stages,
        terminal: {
          stage: 'verify-format',
          subsystem: 'formatter',
          rootCause: `formatter gate failed: ${fmt.message ?? 'no detail'}`,
          finalOutcome: 'VERIFICATION_FAILED',
        },
      };
    }
    stages.verification = PASS(
      `parses; formatter ${fmt.ran ? 'passed' : 'absent (no formatter for this language)'}`,
    );

    // --- Re-analyze the overlay → regression + target-cleared check ---
    const overlayFiles = collectFiles(overlay);
    const after = await analyze(overlay, overlayFiles, input.capabilities);
    const afterIds = new Set(after.map((f) => f.id));
    // Edit mode (finding === null): every new finding counts; there is no target to exclude or clear.
    const newIds = [...afterIds].filter(
      (id) => id !== finding?.id && !input.beforeIds.has(id),
    );
    const targetCleared = finding === null ? true : !afterIds.has(finding.id);

    if (newIds.length > 0) {
      const evidence = after
        .filter((f) => newIds.includes(f.id))
        .map((f) => `${f.source}:${f.ruleId}@${f.location.file}:${String(f.location.startLine)}`);
      stages.reanalysis = FAIL(
        `introduced ${String(newIds.length)} new finding(s): ${evidence.join(', ')}`,
      );
      stages.apply = NOT_RUN('blocked: regression detected');
      return {
        stages,
        terminal: {
          stage: 'regression',
          subsystem: 'regression-verifier',
          rootCause: `repair introduced new finding(s): ${evidence.join(', ')}`,
          finalOutcome: 'REGRESSION_DETECTED',
        },
      };
    }
    if (!targetCleared) {
      stages.reanalysis = FAIL('target finding still present after repair');
      stages.apply = NOT_RUN('blocked: repair did not resolve the finding');
      return {
        stages,
        terminal: {
          stage: 'reanalyze',
          subsystem: 'regression-verifier',
          rootCause: 'the repair applied and parsed but did not clear the target finding',
          finalOutcome: 'VERIFICATION_FAILED',
        },
      };
    }
    stages.reanalysis = PASS('target finding cleared; no new findings introduced');

    // Apply is now governed-clean: confirm the write round-trips byte-for-byte (the real apply's
    // integrity check) before crediting it.
    const readback = readFileSync(absOverlay, 'utf8');
    stages.apply =
      readback === patched
        ? PASS('patched file written and verified byte-for-byte')
        : FAIL('written content did not read back identically');
    if (!stages.apply.ok) {
      return {
        stages,
        terminal: {
          stage: 'apply',
          subsystem: 'apply-engine',
          rootCause: 'overlay write did not round-trip (fs corruption)',
          finalOutcome: 'APPLY_FAILED',
        },
      };
    }

    // --- Compile / type-check the patched overlay (when applicable) ---
    const compile = await compileProject({
      kind: project.manifest.compile,
      root: overlay,
      toolRoot: input.toolRoot,
      files: overlayFiles,
    });
    stages.compile = compile;
    // A compile that flips from green (baseline) to red is a regression the repair caused. A compile
    // that was already red at baseline, or that does not apply, is not held against the repair.
    if (compile.ran && !compile.ok && input.baselineCompileOk === true) {
      return {
        stages,
        terminal: {
          stage: 'compile',
          subsystem: 'compile-runner',
          rootCause: `repair broke a previously-passing compile: ${compile.detail}`,
          finalOutcome: 'REGRESSION_DETECTED',
        },
      };
    }

    return {
      stages,
      terminal: {
        stage: 'compile',
        subsystem: 'none',
        rootCause: 'repair survived analyze → repair → verify → apply → re-analyze → compile',
        finalOutcome: input.successOutcome,
      },
    };
  } finally {
    rmSync(overlay, { recursive: true, force: true });
  }
}

/** Drive one deterministic (safe-auto) repair through the shared gates. */
async function runDeterministic(
  project: DiscoveredProject,
  finding: Finding,
  beforeIds: Set<string>,
  capabilities: WorkspaceCapabilities,
  baselineCompileOk: boolean | null,
  toolRoot: string,
): Promise<{ stages: ReturnType<typeof blankStages>; terminal: Terminal }> {
  const language: Language = languageForPath(finding.location.file) ?? 'javascript';
  const source = readFileSync(join(project.dir, finding.location.file), 'utf8');

  const micro = await deterministicRepair({
    finding,
    source,
    language,
    filePath: finding.location.file,
  });
  if (micro === null) {
    const stages = blankStages();
    stages.repair = FAIL('safe-auto finding produced no composable tool autofix');
    return {
      stages,
      terminal: {
        stage: 'repair',
        subsystem: 'patch-extractor',
        rootCause: 'autofix edits did not compose into a patch (applyEdits returned null)',
        finalOutcome: 'VERIFICATION_FAILED',
      },
    };
  }
  return runGates({
    project,
    file: finding.location.file,
    finding,
    language,
    patched: micro.patched,
    repairStage: PASS(`applied ${String(micro.edits.length)} edit(s) from ${micro.source}`),
    successOutcome: 'SAFE_AUTO_REPAIR_APPLIED',
    beforeIds,
    capabilities,
    baselineCompileOk,
    toolRoot,
  });
}

/**
 * Drive one AI (model) repair through Generate → the shared gates. A generation failure is classified
 * by its exact subsystem (context/prompt/provider/parser) and never reaches the gates; a successful
 * generation is held to exactly the same gate bar as a deterministic repair.
 */
async function runAi(
  project: DiscoveredProject,
  finding: Finding,
  provider: AIProvider,
  model: string,
  beforeIds: Set<string>,
  capabilities: WorkspaceCapabilities,
  baselineCompileOk: boolean | null,
  toolRoot: string,
): Promise<{
  stages: ReturnType<typeof blankStages>;
  terminal: Terminal;
  aiDiagnostic?: AttemptRecord['aiDiagnostic'];
}> {
  const language: Language = languageForPath(finding.location.file) ?? 'javascript';
  const fileContent = readFileSync(join(project.dir, finding.location.file), 'utf8');
  const target = {
    symbolName: finding.evidence.enclosingSymbol?.name ?? null,
    startLine: finding.evidence.enclosingRange?.startLine ?? finding.location.startLine,
    endLine: finding.evidence.enclosingRange?.endLine ?? finding.location.endLine,
  };

  const gen = await generateRepair({
    provider,
    model,
    finding,
    language,
    fileContent,
    workspaceRoot: project.dir,
    target,
  });
  if (!gen.ok) {
    const stages = blankStages();
    stages.repair = FAIL(gen.reason);
    return {
      stages,
      terminal: {
        stage: 'repair',
        subsystem: gen.subsystem,
        rootCause: gen.reason,
        finalOutcome: 'AI_GENERATE_FAILED',
      },
    };
  }
  const aiDiagnostic = {
    targetStartLine: target.startLine,
    targetEndLine: target.endLine,
    repairedCode: gen.repairedCode,
  };
  const result = await runGates({
    project,
    file: finding.location.file,
    finding,
    language,
    patched: gen.patched,
    repairStage: PASS(
      `model generated a repair (confidence ${gen.confidence.toFixed(2)}` +
        (gen.reAsked ? ', after one schema re-ask' : '') +
        `${gen.recovery.length > 0 && gen.recovery[0] !== 'none' ? `, recovery: ${gen.recovery.join('+')}` : ''})`,
    ),
    successOutcome: 'AI_REPAIR_APPLIED',
    beforeIds,
    capabilities,
    baselineCompileOk,
    toolRoot,
  });
  return { ...result, aiDiagnostic };
}

/** Build the record for a finding the engine cannot deterministically repair here. */
function nonDeterministicRecord(
  base: Omit<AttemptRecord, keyof Terminal | keyof ReturnType<typeof blankStages> | 'runtimeMs'>,
  finding: Finding,
): AttemptRecord {
  const stages = blankStages();

  // The engine only produces findings for languages it analyzes (css/html have no analyzer, so they
  // never reach here). What remains is a real classification: manual vs AI-required.
  let terminal: Terminal;
  if (finding.repair === 'manual') {
    terminal = {
      stage: 'eligibility',
      subsystem: 'eligibility-engine',
      rootCause: `rule ${finding.ruleId} needs human intent a machine cannot infer (classified manual)`,
      finalOutcome: 'MANUAL_FIX_REQUIRED',
    };
  } else {
    // ai-required, but there is no provider key: deferred, never faked.
    terminal = {
      stage: 'repair',
      subsystem: 'ai-provider',
      rootCause: 'AI-required repair, no provider key present (FIXORA_BENCH_OPENROUTER_KEY absent)',
      finalOutcome: 'AI_DEFERRED',
    };
  }
  return { ...base, ...stages, ...terminal, runtimeMs: 0 };
}

/** The live-model leg, when a provider key is present. Null → AI-required findings are deferred. */
export interface AiRunner {
  provider: AIProvider;
  model: string;
}

export async function runProject(
  project: DiscoveredProject,
  capabilities: WorkspaceCapabilities,
  toolRoot: string,
  ai: AiRunner | null = null,
): Promise<ProjectResult> {
  const base: ProjectResult = {
    project: project.manifest.name,
    language: project.manifest.language,
    root: project.dir,
    filesAnalyzed: 0,
    findings: 0,
    analyzeMs: 0,
    baselineCompile: null,
    attempts: [],
  };

  const missing = project.manifest.requiresTools.filter((t) => !capabilities.tools.has(t));
  if (missing.length > 0) {
    return {
      ...base,
      error: `skipped: requires ${missing.join(', ')} (not available on this machine)`,
    };
  }

  let files: AnalysisFile[];
  let findings: Finding[];
  const analyzeStart = Date.now();
  try {
    files = collectFiles(project.dir);
    findings = await analyze(project.dir, files, capabilities);
  } catch (error) {
    return {
      ...base,
      error: `analysis crashed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  const analyzeMs = Date.now() - analyzeStart;

  const baselineCompile = await compileProject({
    kind: project.manifest.compile,
    root: project.dir,
    toolRoot,
    files,
  });
  const beforeIds = new Set(findings.map((f) => f.id));

  const attempts: AttemptRecord[] = [];
  for (const finding of findings) {
    const findingLanguage: Language = languageForPath(finding.location.file) ?? 'javascript';
    const common = {
      language: findingLanguage,
      project: project.manifest.name,
      file: finding.location.file,
      ruleId: finding.ruleId,
      source: finding.source,
      severity: finding.severity,
      repairability: finding.repair,
    };

    const baselineOk = baselineCompile.ran ? baselineCompile.ok : null;
    if (finding.repair === 'safe-auto') {
      const start = Date.now();
      const { stages, terminal } = await runDeterministic(
        project,
        finding,
        beforeIds,
        capabilities,
        baselineOk,
        toolRoot,
      );
      attempts.push({ ...common, ...stages, ...terminal, runtimeMs: Date.now() - start });
    } else if (finding.repair === 'ai-required' && ai !== null) {
      const start = Date.now();
      const { stages, terminal, aiDiagnostic } = await runAi(
        project,
        finding,
        ai.provider,
        ai.model,
        beforeIds,
        capabilities,
        baselineOk,
        toolRoot,
      );
      attempts.push({
        ...common,
        ...stages,
        ...terminal,
        runtimeMs: Date.now() - start,
        ...(aiDiagnostic !== undefined ? { aiDiagnostic } : {}),
      });
    } else {
      attempts.push(nonDeterministicRecord(common, finding));
    }
  }

  return {
    ...base,
    filesAnalyzed: files.length,
    findings: findings.length,
    analyzeMs,
    baselineCompile,
    attempts,
  };
}
