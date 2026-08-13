import {
  classifyFinding,
  grammarFor,
  type Finding,
  type GrammarId,
  type Language,
} from '@fixora/shared-types';

import type { GatePart } from '../gate/secret-gate.js';

import { DEFAULT_BUDGETS, estimateTokens, inputBudget, type TokenBudget } from './budget.js';

/**
 * The context builder (AI-Pipeline §1) — where quality actually comes from.
 *
 * It assembles the four grounded layers in priority order: **Target** (the whole enclosing symbol,
 * never a truncated function), **Evidence** (the deterministic Finding — rule, message, snippet), then
 * **Conventions** and ranked **Neighbours**. We never send whole files: the caller (main, which owns
 * the M3 engine) resolves the enclosing symbol's range with `core-analysis`; we slice it here. This is
 * cheaper *and* higher quality, the rare case where the two align.
 *
 * Crucially, the assembled `parts` are exactly what the gate scans before anything leaves — the target
 * slice, the evidence snippet, and every neighbour. Grounding also means the model never chooses what
 * to work on: a `Finding` is required input, and it comes from the deterministic engine (ADR-002).
 */

/** The enclosing-symbol range the caller resolved via core-analysis (1-based, inclusive). */
export interface TargetRange {
  readonly symbolName: string | null;
  readonly startLine: number;
  readonly endLine: number;
}

export interface ContextInput {
  readonly filePath: string;
  readonly language: Language;
  readonly fileContent: string;
  readonly finding: Finding;
  readonly target: TargetRange;
  /**
   * Further problems INSIDE the target range, fixed by the same patch (scope-bounded merge).
   *
   * These never widen the splice range — that is the whole point. The patch covers exactly the lines
   * it always would; it simply resolves everything wrong within them rather than stepping over
   * problems the model can plainly see.
   */
  readonly relatedFindings?: readonly Finding[];
  /**
   * True only when this is a `manual`-repairability finding being attempted anyway via `ai:run`'s
   * `allowManual` opt-in ("Repair All Repairable" only — see `bulk-repair-store.ts`). Without this,
   * `formatEvidence` would tell the model "Fixora will not repair this automatically" in the SAME
   * prompt asking it to — that text exists for Explain, where it's true; here it would be stale and
   * self-contradictory, since eligibility already refused every manual finding this flag isn't set for.
   */
  readonly attemptingManualRepair?: boolean;
  /** Ranked, droppable extra context (imports, referenced symbols) — best first. */
  readonly neighbours?: readonly GatePart[];
  /** Detected project conventions, e.g. 'TypeScript strict mode', 'test framework: vitest'. */
  readonly conventions?: readonly string[];
  readonly budget?: TokenBudget;
}

export interface BuiltTarget {
  readonly symbolName: string | null;
  readonly startLine: number;
  readonly endLine: number;
  readonly text: string;
}

export interface BuiltContext {
  readonly filePath: string;
  readonly language: Language;
  /**
   * The dialect this file actually is, chosen by the SAME function the verifier parses with.
   * Carried here so the repair prompt and the parser gate can never name different languages.
   */
  readonly grammarId: GrammarId;
  readonly finding: Finding;
  readonly target: BuiltTarget;
  readonly evidenceText: string;
  readonly conventions: readonly string[];
  readonly neighbours: readonly GatePart[];
  /** Everything destined for the provider, labelled — the exact set the gate scans. */
  readonly parts: readonly GatePart[];
  readonly estimatedTokens: number;
  readonly droppedNeighbours: number;
}

/** Slice a 1-based inclusive line range out of file content. */
function sliceLines(content: string, startLine: number, endLine: number): string {
  const lines = content.split('\n');
  const from = Math.max(0, startLine - 1);
  const to = Math.min(lines.length, endLine);
  return lines.slice(from, to).join('\n');
}

function formatEvidence(
  finding: Finding,
  related: readonly Finding[] = [],
  attemptingManualRepair = false,
): string {
  const { location } = finding;
  const where = `${location.file}:${String(location.startLine)}:${String(location.startCol)}`;
  const lines = [
    `Finding [${finding.source}] ${finding.ruleId} (${finding.severity}, ${finding.category})`,
    `at ${where}`,
    `message: ${finding.message}`,
    'code in question:',
    finding.evidence.snippet,
  ];
  if (attemptingManualRepair) {
    // The rule-specific/deterministic-fix path doesn't apply here — this finding's own analyzer
    // marked it manual-only — so the model gets the plainest possible framing instead: the rule and
    // message, asked to fix directly. Still returns through the identical JSON-schema, parser/
    // verifier/formatter-gated pipeline as every other repair; only the instruction is generic.
    lines.push(
      '',
      `Refactor this code to fix: ${finding.ruleId} — ${finding.message}`,
      'Preserve the existing behaviour. If you cannot determine a safe, correct fix for this specific',
      'code, return the target unchanged rather than guessing — verification will then correctly mark',
      'it unresolved instead of applying a wrong change.',
    );
  } else {
    // Why the engine will not repair this, when it will not. Explain is asked to cover that
    // question, and without the classification in its evidence it can only guess at the answer — or
    // invent one. Derived from the same `classifyFinding` the panel shows, so the prose and UI agree.
    const classification = classifyFinding(finding);
    if (classification.category !== 'repairable') {
      lines.push(
        '',
        `Fixora classification: ${classification.title}`,
        `Fixora will not repair this automatically because: ${classification.reason}`,
        ...(classification.suggestedFix === undefined
          ? []
          : [`Known fix: ${classification.suggestedFix}`]),
      );
    }
  }
  // Complexity findings have no deterministic fix, but a model can lower the metric while staying
  // within "replace only the target symbol": nested local helpers and early returns are part of the
  // SAME replacement text, never a second top-level declaration outside the range.
  if (finding.ruleId === 'cyclomatic-complexity' || finding.ruleId === 'cognitive-complexity') {
    lines.push(
      '',
      'This is a complexity finding: reduce the metric below its threshold by refactoring, not by',
      'deleting logic. Techniques, in order of preference: (1) extract cohesive chunks of the body into',
      'local helper functions declared inside this same replacement (a nested function or a',
      'const-assigned closure) — this lowers the enclosing function\'s own complexity even though the',
      'logic still runs in the same place; (2) flatten nested conditionals with early returns / guard',
      'clauses instead of deep if/else nesting; (3) simplify redundant branches. The behaviour must be',
      'unchanged — this is a structural refactor, not a logic change.',
    );
  }
  // Framed as additional problems to resolve within the SAME replacement, never as separate tasks:
  // the model returns one block of code for one range, so presenting these as extra jobs would
  // invite several edits it has no way to express.
  if (related.length > 0) {
    lines.push(
      '',
      'Also fix these problems, which are inside the same code you are replacing.',
      'Return ONE corrected version of that code that resolves all of them together:',
      ...related.map(
        (f) => `- line ${String(f.location.startLine)} [${f.source}] ${f.ruleId}: ${f.message}`,
      ),
    );
  }
  return lines.join('\n');
}

export function buildContext(input: ContextInput): BuiltContext {
  const budget = input.budget ?? DEFAULT_BUDGETS.repair;
  const cap = inputBudget(budget);

  const targetText = sliceLines(input.fileContent, input.target.startLine, input.target.endLine);
  const target: BuiltTarget = {
    symbolName: input.target.symbolName,
    startLine: input.target.startLine,
    endLine: input.target.endLine,
    text: targetText,
  };
  const evidenceText = formatEvidence(
    input.finding,
    input.relatedFindings ?? [],
    input.attemptingManualRepair ?? false,
  );

  // Target + evidence are never dropped, even if they alone exceed the cap (we never truncate them).
  const parts: GatePart[] = [
    { label: input.filePath, text: targetText },
    { label: `evidence:${input.finding.source}`, text: evidenceText },
  ];
  let used = estimateTokens(targetText) + estimateTokens(evidenceText);

  // Conventions: higher priority than neighbours, but only if there is room.
  const conventions: string[] = [];
  const conventionsList = input.conventions ?? [];
  if (conventionsList.length > 0) {
    const conventionsText = conventionsList.join('\n');
    if (used + estimateTokens(conventionsText) <= cap) {
      used += estimateTokens(conventionsText);
      conventions.push(...conventionsList);
      parts.push({ label: 'conventions', text: conventionsText });
    }
  }

  // Neighbours: ranked best-first; keep while they fit, drop the rest whole.
  const keptNeighbours: GatePart[] = [];
  let droppedNeighbours = 0;
  for (const neighbour of input.neighbours ?? []) {
    const cost = estimateTokens(neighbour.text);
    if (used + cost <= cap) {
      used += cost;
      keptNeighbours.push(neighbour);
      parts.push(neighbour);
    } else {
      droppedNeighbours += 1;
    }
  }

  return {
    filePath: input.filePath,
    language: input.language,
    grammarId: grammarFor(input.language, input.filePath),
    finding: input.finding,
    target,
    evidenceText,
    conventions,
    neighbours: keptNeighbours,
    parts,
    estimatedTokens: used,
    droppedNeighbours,
  };
}
