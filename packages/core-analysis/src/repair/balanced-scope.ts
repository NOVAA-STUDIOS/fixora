import type { Node } from 'web-tree-sitter';

import type { RepairScope } from '../analyzer.js';

/**
 * Scope resolution for **delimiter-class syntax findings** — and for nothing else.
 *
 * The problem this solves, proven during manual validation: when a file has an unbalanced delimiter,
 * the parser reports the error where it *gave up*, not where the structure broke. The normal repair
 * target (the smallest construct containing the reported line) therefore excludes the actual defect,
 * and can even point at unrelated, perfectly valid code. Two consequences, both observed:
 *
 *  - a CSS finding for an unclosed `.card {` was reported at line 5 — a different, valid rule — so the
 *    model was shown correct code and told it was broken;
 *  - a TypeScript function missing its `}` produced a target of the one statement inside it, so **no
 *    possible in-scope patch could make the file parse**, and the verifier correctly rejected every
 *    attempt. The pipeline was asking for something impossible.
 *
 * The fix is to target the OUTERMOST construct containing the line rather than the innermost. For an
 * unbalanced delimiter that construct is precisely the one whose delimiter is missing, so the defect
 * is inside the patch and a repair becomes possible at all.
 *
 * ## Why this is safe to widen here and nowhere else
 *
 * Widening a splice range widens what a wrong patch can damage, so it is only justified where the
 * narrow range is *provably unusable*. That is exactly the delimiter case and only the delimiter
 * case: every other finding sits inside a construct that already parses, where the smallest scope
 * both contains the defect and keeps the blast radius minimal. Callers gate on rule class before
 * calling this — see `isDelimiterRule`.
 */

/**
 * Rules whose defect is an unbalanced delimiter, so the reported location is where the parser
 * stopped rather than where the code is wrong.
 *
 * Deliberately an explicit list rather than a heuristic: this is the only set of findings permitted a
 * wider repair target, so which rules qualify must be auditable rather than inferred.
 */
const DELIMITER_RULES = new Set<string>([
  // Fixora's own Tier-B grammar validators.
  'css-syntax',
  'html-syntax',
  'json-parse',
  // TypeScript's syntactic diagnostics: a token the grammar required was absent.
  'TS1005', // "'X' expected."
  'TS1003', // "Identifier expected."
  'TS1109', // "Expression expected."
  'TS1128', // "Declaration or statement expected."
  'TS1136', // "Property assignment expected."
  'TS1381', // "Unexpected token. Did you mean '}'?"
  'TS1382', // "Unexpected token. Did you mean '>'?"
  'TS1434', // "Unexpected keyword or identifier."
  // Ruff reports every Python syntax error under one code.
  'E999',
]);

export function isDelimiterRule(ruleId: string): boolean {
  return DELIMITER_RULES.has(ruleId);
}

/**
 * The outermost construct containing `line` — the top-level statement, rule, or element it belongs to.
 *
 * Outermost, not innermost, because that is the one whose delimiter is unbalanced. Bounded by
 * construction: it returns a direct child of the root, so it is one top-level unit and never the
 * whole file unless the file genuinely is a single construct.
 */
export function outermostConstructContaining(
  root: Node,
  line: number,
): { startLine: number; endLine: number } | null {
  let nearestBefore: { startLine: number; endLine: number } | null = null;
  for (let i = 0; i < root.childCount; i++) {
    const child = root.child(i);
    if (child === null) continue;
    const startLine = child.startPosition.row + 1;
    const endLine = child.endPosition.row + 1;
    if (startLine <= line && endLine >= line) return { startLine, endLine };
    // Remember the closest construct that ends before the line — see the fallback below.
    if (endLine <= line && (nearestBefore === null || endLine > nearestBefore.endLine)) {
      nearestBefore = { startLine, endLine };
    }
  }
  /**
   * Nothing contained the line. That is not a miss — it is the signature of the very defect this
   * function exists for: an unterminated construct makes the parser give up at (or past) the end of
   * the file, so the reported line can sit *beyond* every node's range. Measured on `{\n "a": 1,\n
   * "b": 2\n` — JSON reports line 4, while the object node ends at line 3.
   *
   * The construct that ended closest before that point is the one still waiting for its delimiter, so
   * it is the correct target. Still bounded to a single top-level construct.
   */
  return nearestBefore;
}

/**
 * The same choice, made from the repair scopes the analyzer already collected.
 *
 * Used by the tool adapters, which have `RepairScope[]` rather than a live tree. Picks the widest
 * scope containing the line — the counterpart of `smallestScopeContaining`, and its opposite by
 * design.
 */
export function outermostScopeContaining(
  scopes: readonly RepairScope[],
  line: number,
): RepairScope | null {
  let widest: RepairScope | null = null;
  for (const scope of scopes) {
    if (scope.startLine > line || scope.endLine < line) continue;
    if (widest === null || scope.endLine - scope.startLine > widest.endLine - widest.startLine) {
      widest = scope;
    }
  }
  return widest;
}
