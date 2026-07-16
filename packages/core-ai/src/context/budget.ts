import type { TaskProfile } from '@fixora/shared-types';

/**
 * The token budgeter (AI-Pipeline §1). Hard caps per profile. When context exceeds budget it drops
 * the lowest-ranked neighbour **whole** — it never truncates mid-symbol, because a half-function in
 * the window is worse than no function: the model will confidently reason about code whose end it
 * cannot see. Target and evidence are never dropped; conventions go before neighbours in priority but
 * are dropped after them (they are cheap and high-signal).
 *
 * We estimate tokens as chars/4 — deliberately rough and slightly generous, because the budgeter's
 * job is to *prevent* a provider length error, so erring toward a smaller prompt is the safe bias.
 */

export interface TokenBudget {
  /** Total context window we will use. */
  readonly total: number;
  /** Held back for the model's answer — never spent on input. */
  readonly reserveForOutput: number;
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function inputBudget(budget: TokenBudget): number {
  return Math.max(0, budget.total - budget.reserveForOutput);
}

/**
 * Per-profile budgets. Conservative for the beta and BYOK — a user paying per token should not have
 * a runaway prompt, and every model we route to via OpenRouter clears these comfortably.
 */
export const DEFAULT_BUDGETS: Record<TaskProfile, TokenBudget> = {
  repair: { total: 32_000, reserveForOutput: 4_000 },
  explain: { total: 16_000, reserveForOutput: 1_500 },
  test: { total: 32_000, reserveForOutput: 4_000 },
};
