import type { RepairScope, RepairScopeLevel } from '../analyzer.js';

/**
 * Scope escalation — widening a repair range by one AST level when the narrow one is *provably*
 * unusable.
 *
 * `scope-selector.ts` picks the smallest region that parses standalone, which is the right default:
 * a one-line fix should not regenerate a whole function. But some repairs are genuinely not confined
 * to where the problem is reported. The canonical case:
 *
 * ```ts
 * const response = fetch(url);      // the prerequisite
 * const data = response.json();     // the finding, and the repair target
 * ```
 *
 * Adding `await` to line 2 is correct and still does not compile, because `response` is a promise.
 * The fix needs both lines, and the second line alone is a range in which **no correct patch exists**.
 * Widening to the enclosing scope puts the prerequisite inside the splice, so the repair can be
 * emitted complete — and then verified normally.
 *
 * ## Why widening is safe *here*
 *
 * The splice range is the blast radius, so widening is only ever justified where the narrow range is
 * provably unusable — the same bar `balanced-scope.ts` sets for unbalanced delimiters. Three
 * constraints keep this honest:
 *
 *  1. **Evidence-gated.** The caller only escalates after the verifier has actually rejected a patch
 *     *and* `detectDependentFailure` has attributed that rejection to something outside the range.
 *     A model that was simply wrong does not widen anything.
 *  2. **One level at a time.** Each step takes the smallest containing scope that is strictly larger,
 *     so a statement grows to its declaration or enclosing function — not to the file.
 *  3. **Capped below the module.** `collectScopes` never emits `module` scopes, and the default cap
 *     stops at `function`. Regenerating a whole class or file remains what it is today: a deliberate,
 *     user-confirmed Advanced/AI-file repair, never something the engine escalates into on its own.
 *
 * Widening never enables Apply. The wider patch is verified by the identical pipeline on a fresh
 * overlay; if it still fails, it is still rejected.
 */

/** Ascending blast radius. `module` is listed for ordering only — it is never a selectable target. */
const LEVEL_ORDER: readonly RepairScopeLevel[] = [
  'statement',
  'declaration',
  'function',
  'class',
  'module',
];

function rank(level: RepairScopeLevel): number {
  const index = LEVEL_ORDER.indexOf(level);
  return index === -1 ? LEVEL_ORDER.length : index;
}

export interface WidenInput {
  /** Every scope-eligible range in the file, from `collectScopes`. */
  readonly scopes: readonly RepairScope[];
  /** The range the rejected patch was generated against. */
  readonly current: { readonly startLine: number; readonly endLine: number };
  /**
   * Lines the widened scope MUST contain — the prerequisite sites the verifier pointed at. Empty is
   * normal and means "just go up one level": the dependent error sat inside the range, so the
   * declaration it needs is simply somewhere above.
   */
  readonly mustInclude?: readonly number[];
  /**
   * The largest level this may escalate to. Defaults to `function`, which covers the dependency
   * cases worth automating (a prerequisite statement in the same function) without ever silently
   * rewriting a class.
   */
  readonly maxLevel?: RepairScopeLevel;
}

/**
 * The next scope up: the smallest scope that contains the current range, contains every prerequisite
 * line, and is strictly larger than the range it replaces.
 *
 * Returns null when no such scope exists within the cap — the caller then stops escalating and
 * surfaces its best attempt with the verifier's reason, rather than reaching for the whole file.
 */
export function widenRepairScope(input: WidenInput): RepairScope | null {
  const maxRank = rank(input.maxLevel ?? 'function');
  const required = [
    input.current.startLine,
    input.current.endLine,
    ...(input.mustInclude ?? []),
  ];
  const needStart = Math.min(...required);
  const needEnd = Math.max(...required);
  const currentSpan = input.current.endLine - input.current.startLine;

  let best: RepairScope | null = null;
  for (const scope of input.scopes) {
    if (rank(scope.level) > maxRank) continue;
    // Must cover everything the repair now needs to touch.
    if (scope.startLine > needStart || scope.endLine < needEnd) continue;
    // Must be a genuine step UP. A scope with identical bounds is the same ask that just failed, and
    // returning it would spin the retry loop against an unchanged range.
    const span = scope.endLine - scope.startLine;
    if (span <= currentSpan) continue;
    if (best === null || span < best.endLine - best.startLine) best = scope;
  }
  return best;
}
