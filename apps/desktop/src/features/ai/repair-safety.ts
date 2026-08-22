/**
 * Group Repair safety checks (feature: warnings + harmful-fix detection + accuracy gate).
 *
 * Both checks are pattern-based heuristics over the proposal's own text — cheap, deterministic,
 * and run client-side before a bulk repair is allowed to auto-apply. Neither replaces
 * verification (`evaluateApplyGate`/the analyzer re-run): a patch can pass both and still be
 * refused there, and a patch flagged here can still be genuinely correct — these exist to put a
 * human in the loop on the specific shapes of change that are cheap to auto-apply but expensive
 * to auto-apply WRONG.
 */

const HARMFUL_PATTERNS: { pattern: RegExp; reason: string }[] = [
  {
    pattern: /\/\/\s*.+\{[\s\S]*?\}|\/\*[\s\S]*?\{[\s\S]*?\}[\s\S]*?\*\//,
    reason: 'Comments out a logic block instead of removing genuinely unused code',
  },
  {
    pattern: /\b(auth|authenticate|authoriz|password|token|session|permission|jwt|oauth)\w*\s*[({=]/i,
    reason: 'Touches authentication/authorization-related code',
  },
  {
    pattern: /\btry\s*\{[\s\S]*$/m,
    reason: 'Removes error handling (try/catch)',
  },
  {
    pattern: /(api[_-]?key|secret|password|token)\s*[:=]\s*['"][^'"]{8,}['"]/i,
    reason: 'Hardcodes a secret or credential',
  },
];

export interface HarmfulFixResult {
  readonly harmful: boolean;
  readonly reasons: readonly string[];
}

/**
 * Compares before/after so "this file already had a try/catch and still does" is not flagged —
 * only a pattern that is NEW in the repaired code (present after, absent before) counts as the
 * repair itself introducing it.
 */
export function detectHarmfulFix(originalCode: string, repairedCode: string): HarmfulFixResult {
  const reasons: string[] = [];
  for (const { pattern, reason } of HARMFUL_PATTERNS) {
    const before = pattern.test(originalCode);
    const after = pattern.test(repairedCode);
    if (after && !before) reasons.push(reason);
  }
  return { harmful: reasons.length > 0, reasons };
}

const UNCERTAINTY_PHRASES = ['might', 'could', 'not sure', 'may', 'possibly', 'perhaps', 'i think'];

/** Low confidence is advisory only (never blocks apply) — it flags the rationale's own wording,
 *  not the patch's correctness. */
export function isLowConfidence(rationale: string): boolean {
  const text = rationale.toLowerCase();
  return UNCERTAINTY_PHRASES.some((phrase) => text.includes(phrase));
}
