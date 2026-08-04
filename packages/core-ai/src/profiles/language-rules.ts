import type { GrammarId } from '@fixora/shared-types';

/**
 * The language rule layer.
 *
 * `REPAIR_SYSTEM` states the *policy* — fix one finding, rewrite only the target, return this JSON.
 * A rule here states the *dialect* — what this particular file may and may not contain. The two are
 * kept apart deliberately: the policy is one shared string with no language in it, and dialects are
 * data. Nothing here duplicates prompt text.
 *
 * ## Why this exists
 *
 * A diagnostic can be reported by a tool whose syntax is broader than the file's. `tsc` type-checks
 * JavaScript via `checkJs`, so a `.js` file receives errors phrased in TypeScript — "Argument of
 * type 'any' is not assignable to parameter of type 'never'". Observed in production: the model read
 * that, reached for the canonical TypeScript remedy, and returned `token as never` and then
 * `(user.tokens as any[])`. Both are correct answers to the diagnostic and neither is valid
 * JavaScript; the parser gate rejected them and Apply stayed disabled, twice.
 *
 * The prompt already said `Language: javascript` — three times. It was never the missing fact, it
 * was the missing *rule*: a declarative label loses to an instruction-shaped diagnostic sitting in
 * the next section. So a rule is stated as a constraint, adjacent to the text that provokes it.
 *
 * ## Keyed by GrammarId, not Language
 *
 * `GrammarId` is what the VERIFIER parses with (`grammarFor` in shared-types, consumed by
 * `core-analysis`'s `parse()`). Keying the rule the same way means the dialect the model is told to
 * write and the grammar its reply is judged by are chosen by one function call, and cannot drift.
 * It also keeps `.tsx` distinguishable from `.ts`, which `Language` alone collapses.
 *
 * ## Adding a language
 *
 * One entry. The bar is deliberately high, because a permissive table becomes noise the model learns
 * to skim: add an entry ONLY when a superset or sibling language exists whose syntax a model
 * plausibly emits and this file cannot parse. `typescript` has no entry and should not — it is a
 * superset of JavaScript, so a model erring toward plain JS still produces valid TypeScript. Absence
 * is the correct encoding of "nothing to exclude", never an oversight.
 */
export interface LanguageRule {
  /** What this file may contain, in one clause. */
  readonly dialect: string;
  /** Named constructs that will not parse here. Specific beats general — models match on shapes. */
  readonly forbidden: string;
  /**
   * A legal route to the same fix.
   *
   * Not decoration. A bare prohibition aimed at a type error invites either a refusal or a no-op
   * edit that still fails verification. Naming the alternative — JSDoc especially, which satisfies
   * `checkJs` in JavaScript's own syntax — gives the model somewhere to go.
   */
  readonly instead: string;
}

const RULES: Partial<Record<GrammarId, LanguageRule>> = {
  javascript: {
    dialect: 'ECMAScript only — this file is plain JavaScript, not TypeScript.',
    forbidden:
      'type assertions (`x as T`, `<T>x`), type annotations (`x: T`), `interface`, `enum`, ' +
      'declaration modifiers (`public`, `private`, `readonly`), and generic type parameters — these ' +
      'are TypeScript and will not parse in a .js file',
    instead:
      'runtime constructs the language actually has: guards and narrowing checks, default values, ' +
      'or a JSDoc annotation such as `/** @type {string[]} */` when the fix is genuinely about types',
  },
};

/** The rule for a grammar, or null when that dialect needs no exclusions. */
export function languageRuleFor(grammar: GrammarId): LanguageRule | null {
  return RULES[grammar] ?? null;
}

/**
 * Render a rule as the prompt block. Returns null when there is no rule, so the caller emits nothing
 * and the prompt stays byte-identical to what it was before this layer existed.
 */
export function languageRuleBlock(grammar: GrammarId): string | null {
  const rule = languageRuleFor(grammar);
  if (rule === null) return null;
  return [
    `Valid syntax for this file: ${rule.dialect}`,
    `Do not emit: ${rule.forbidden}.`,
    `Use instead: ${rule.instead}.`,
  ].join('\n');
}
