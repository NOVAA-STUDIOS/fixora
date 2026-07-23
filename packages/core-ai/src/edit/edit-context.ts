import type { EditIntent, Language } from '@fixora/shared-types';

import {
  DEFAULT_BUDGETS,
  estimateTokens,
  inputBudget,
  type TokenBudget,
} from '../context/budget.js';
import type { GatePart } from '../gate/secret-gate.js';

/**
 * The editing Context Builder (Proceed Mode, objective 4).
 *
 * The sibling of the repair context builder: it assembles the SMALLEST valid context for an edit —
 * the target scope, the user's instruction, project conventions, and ranked neighbours (imports and
 * referenced symbols) — within the same token budget, and it produces the same `parts` array so the
 * SAME secret gate scans every byte before anything leaves. It never sends a whole file, and never a
 * whole repository. It reuses the repair engine's budget/gate primitives rather than re-deriving them;
 * only the shape of the task (an instruction, not a Finding) differs.
 */

export interface EditTarget {
  readonly symbolName: string | null;
  readonly startLine: number;
  readonly endLine: number;
  /** The exact source of the target scope — sliced by the caller (core-analysis owns the AST). */
  readonly text: string;
}

export interface EditContextInput {
  readonly instruction: string;
  readonly intent: EditIntent;
  readonly filePath: string;
  readonly language: Language;
  readonly target: EditTarget;
  /** Ranked, droppable extra context (imports, referenced symbols) — best first. */
  readonly neighbours?: readonly GatePart[];
  /** Detected project conventions, e.g. 'TypeScript strict mode', 'Framework: React'. */
  readonly conventions?: readonly string[];
  readonly budget?: TokenBudget;
}

export interface EditContext {
  readonly instruction: string;
  readonly intent: EditIntent;
  readonly filePath: string;
  readonly language: Language;
  readonly target: EditTarget;
  readonly conventions: readonly string[];
  readonly neighbours: readonly GatePart[];
  /** Everything destined for the provider, labelled — the exact set the gate scans. */
  readonly parts: readonly GatePart[];
  readonly estimatedTokens: number;
  readonly droppedNeighbours: number;
}

export function buildEditContext(input: EditContextInput): EditContext {
  // Edits reuse the repair budget — same 32k envelope, no new profile added to the shared vocabulary.
  const budget = input.budget ?? DEFAULT_BUDGETS.repair;
  const cap = inputBudget(budget);

  // The instruction and the target scope are load-bearing and never dropped — an edit cannot be
  // performed without both, so they go in first and are never trimmed for budget.
  const parts: GatePart[] = [
    { label: `instruction`, text: input.instruction },
    { label: input.filePath, text: input.target.text },
  ];
  let used = estimateTokens(input.instruction) + estimateTokens(input.target.text);

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
    instruction: input.instruction,
    intent: input.intent,
    filePath: input.filePath,
    language: input.language,
    target: input.target,
    conventions,
    neighbours: keptNeighbours,
    parts,
    estimatedTokens: used,
    droppedNeighbours,
  };
}
