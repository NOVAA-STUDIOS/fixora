import type { CatalogueModel } from './catalogue.js';

/**
 * Smart model routing — picking the best model for a task, WITHIN a provider the user has already
 * chosen to use.
 *
 * This is deliberately narrow. "The orchestrator always follows user priority" is an approved,
 * load-bearing guarantee from the Provider Platform sprint: provider ORDER is never touched here, and
 * an explicit model the user picked (the common case — migration sets one for every existing user) is
 * never overridden. Routing applies only when a provider's model is left at "auto" (unset), where it
 * upgrades a single static default into a task-appropriate pick from that provider's own catalogue.
 *
 * Today only OpenRouter exposes a catalogue to route within (`discovery: 'catalogue'`); other
 * providers resolve to their descriptor's one default until they gain the same kind of listing.
 */

export type RepairComplexity = 'low' | 'medium' | 'high';

/**
 * A model whose name suggests deliberate multi-step reasoning (a "thinking" or "reasoning" model).
 * No provider publishes a structured reasoning flag Fixora can read (ADR: capabilities are read, never
 * assumed) — this is the same honest fallback the catalogue already uses for `codeCapable`: a
 * name/description heuristic, not a guarantee, and it never OVERRIDES a real per-model capability.
 */
const REASONING_HINT = /\b(reasoning|thinking|r1|o1|o3|o4)\b/i;

/** Rough token-per-character estimate, shared with context-budget code elsewhere. */
const CHARS_PER_TOKEN = 4;

export interface ComplexityInput {
  readonly language: string;
  /** Size of the content actually being sent, in characters. */
  readonly contentChars: number;
  /** How many findings this repair is coordinating (Advanced Repair sends more than one). */
  readonly findingCount: number;
}

/**
 * A coarse complexity estimate, driving which model property matters most.
 *
 * Deliberately coarse: this is a routing HINT, not a claim about the code. Three buckets are enough
 * to prefer a fast model for a one-line CSS fix and a strong-reasoning, long-context model for a
 * multi-finding TypeScript file, without pretending to measure "how hard" a repair really is.
 */
export function estimateComplexity(input: ComplexityInput): RepairComplexity {
  const tokens = input.contentChars / CHARS_PER_TOKEN;
  // TypeScript/TSX carry the type system on top of the code itself — the same file size means more
  // for a model to hold in mind than the equivalent CSS or JSON.
  const reasoningHeavyLanguage = input.language === 'typescript' || input.language === 'tsx';

  if (input.findingCount > 1 || tokens > 6_000) return 'high';
  if (reasoningHeavyLanguage || tokens > 1_500) return 'medium';
  return 'low';
}

export interface RoutingTask {
  readonly complexity: RepairComplexity;
  /** Estimated prompt size in tokens, so a model whose context window cannot fit it is excluded. */
  readonly estimatedTokens: number;
}

/**
 * Rank a provider's own models for a task, best first.
 *
 * Filters to models that can actually do the job (structured output, room for the prompt) before
 * ranking — a model that would fail outright is never "ranked low", it is excluded, matching the
 * existing "capabilities are read, never assumed" rule for the boolean facts this reads.
 *
 * `successRate` is optional per-model history (0–1, from the existing repair-metrics store); when
 * present it breaks ties between otherwise-equivalent models, never overriding a capability filter.
 */
export function rankModelsForTask(
  models: readonly CatalogueModel[],
  task: RoutingTask,
  successRate?: (modelId: string) => number | null,
): CatalogueModel[] {
  const viable = models.filter(
    (m) => m.structuredOutput && (m.contextLength ?? 0) >= task.estimatedTokens,
  );

  const score = (m: CatalogueModel): number => {
    let s = 0;
    if (task.complexity === 'high') {
      // A model with real headroom past what THIS request needs is less likely to truncate a
      // coordinated, multi-finding patch — reward margin, not just "big enough".
      s += Math.min(4, (m.contextLength ?? 0) / Math.max(1, task.estimatedTokens));
      if (REASONING_HINT.test(m.name) || REASONING_HINT.test(m.id)) s += 2;
      if (m.codeCapable) s += 1;
    } else if (task.complexity === 'low') {
      // For a simple fix, a smaller/cheaper model is the better pick, not a wasted large one —
      // reward LESS unused headroom rather than more.
      s -= Math.min(2, (m.contextLength ?? 0) / 100_000);
      if (m.free) s += 1;
    } else {
      if (m.codeCapable) s += 1;
      if (m.free) s += 0.5;
    }
    const history = successRate?.(m.id) ?? null;
    if (history !== null) s += history; // 0..1 tiebreak, never dominant over the buckets above
    return s;
  };

  return [...viable].sort((a, b) => score(b) - score(a));
}

/** Best single pick, or null when nothing on this provider can do the job at all. */
export function selectBestModel(
  models: readonly CatalogueModel[],
  task: RoutingTask,
  successRate?: (modelId: string) => number | null,
): CatalogueModel | null {
  return rankModelsForTask(models, task, successRate)[0] ?? null;
}
