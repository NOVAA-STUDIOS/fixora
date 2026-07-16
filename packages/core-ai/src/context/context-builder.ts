import type { Finding, Language } from '@fixora/shared-types';

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

function formatEvidence(finding: Finding): string {
  const { location } = finding;
  const where = `${location.file}:${String(location.startLine)}:${String(location.startCol)}`;
  return [
    `Finding [${finding.source}] ${finding.ruleId} (${finding.severity}, ${finding.category})`,
    `at ${where}`,
    `message: ${finding.message}`,
    'code in question:',
    finding.evidence.snippet,
  ].join('\n');
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
  const evidenceText = formatEvidence(input.finding);

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
