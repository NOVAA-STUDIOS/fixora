import type { NewFinding, VerificationReport } from './ai.js';

/**
 * Detecting a **dependent** verification failure — one the current patch range provably cannot fix.
 *
 * The motivating case, observed in production:
 *
 * ```ts
 * const response = fetch(url);          // line 1 — the real prerequisite
 * const data = response.json();         // line 2 — the reported finding
 * ```
 *
 * The finding is on line 2, so the repair target is line 2, and the model dutifully returns
 * `const data = await response.json();`. That patch is *correct in isolation and still does not
 * compile*: `response` is a `Promise<Response>`, so `.json()` does not exist on it. The prerequisite
 * edit — adding `await` on line 1 — lies outside the splice range, so **no possible replacement of
 * line 2 alone compiles**. The verifier was right to reject every attempt; the pipeline was asking
 * for something impossible, and the existing verify-retry loop simply re-asked the same impossible
 * question three times.
 *
 * This module answers the narrow question that unblocks it: *is this failure the shape that a wider
 * scope could fix?* When yes, the caller widens the repair scope one AST level and regenerates, so
 * the prerequisite edit and the original fix are emitted **together, as one repair**.
 *
 * ## What this is NOT
 *
 * It never relaxes a gate, and a `true` here does not make anything applicable. It only decides
 * whether re-asking is worth doing at a *wider* range instead of the same one. Every regenerated
 * patch goes through the identical overlay verification, and if the widened attempt still fails, the
 * user sees that attempt with Apply disabled and the verifier's own reason — same as today.
 */

/** The splice range a repair was generated against (1-based, inclusive). */
export interface PatchRange {
  readonly startLine: number;
  readonly endLine: number;
}

export interface DependentFailure {
  /**
   * Lines outside the patch range that the evidence points at, so the caller can widen to a scope
   * that contains them. Empty when the dependent error sits *inside* the range but is caused by a
   * declaration elsewhere (the `fetch` case) — there the caller widens by one AST level regardless,
   * which is what brings the declaration in.
   */
  readonly prerequisiteLines: readonly number[];
  /** The verifier findings this decision was made from. Shown to the model on the re-ask. */
  readonly evidence: readonly NewFinding[];
  /** Why this looks dependent, in the user's and the model's language. */
  readonly reason: string;
}

/**
 * Rule identifiers whose cause is a **symbol's declaration**, which may sit outside the patch.
 *
 * This allowlist is the whole safety argument for widening, so it is deliberately narrow. Every entry
 * is an error about what a name *is* — its type, its existence, its nullability — never about the
 * shape of the code at the error site. That distinction matters: a style violation or an unused
 * variable is fully fixable where it stands, so widening for one would spend a larger blast radius on
 * a model that was simply wrong. These, by contrast, are exactly the errors a missing prerequisite
 * edit produces.
 *
 * Matched case-insensitively against the rule id, and against a trailing `TSxxxx` in the message for
 * analyzers that report the code there rather than as the id.
 */
const DEPENDENCY_SHAPED_RULES: readonly string[] = [
  // --- TypeScript: the name does not exist, or is not what the code assumes it is ---
  'ts2304', // Cannot find name 'x'.
  'ts2339', // Property 'json' does not exist on type 'Promise<Response>'.  <- the fetch case
  'ts2551', // Property 'x' does not exist ... did you mean 'y'?
  'ts2322', // Type 'X' is not assignable to type 'Y'.
  'ts2345', // Argument of type 'X' is not assignable to parameter of type 'Y'.
  'ts2739', // Type 'X' is missing the following properties from type 'Y'.
  'ts2741', // Property 'x' is missing in type 'X' but required in type 'Y'.
  'ts2769', // No overload matches this call.
  // --- TypeScript: the value's type is wider than the use site assumes (unawaited promise, null) ---
  'ts2531', // Object is possibly 'null'.
  'ts2532', // Object is possibly 'undefined'.
  'ts2571', // Object is of type 'unknown'.
  'ts18046', // 'x' is of type 'unknown'.
  'ts18047', // 'x' is possibly 'null'.
  'ts18048', // 'x' is possibly 'undefined'.
  // --- Lint rules that are literally about a missing/misplaced await or an unresolved name ---
  '@typescript-eslint/await-thenable',
  '@typescript-eslint/no-floating-promises',
  '@typescript-eslint/no-misused-promises',
  'require-await',
  'no-undef',
  // --- Python ---
  'f821', // undefined name
];

/** True when this rule's cause can live outside the code that reports it. */
export function isDependencyShapedRule(ruleId: string, message = ''): boolean {
  const id = ruleId.toLowerCase();
  if (DEPENDENCY_SHAPED_RULES.includes(id)) return true;
  // Analyzers that carry the TS code in the message rather than the rule id (e.g. a generic
  // `typescript` source). Anchored to the TSxxxx token so it cannot match an arbitrary number.
  const code = /\bts(\d{4,5})\b/i.exec(`${ruleId} ${message}`);
  return code === null ? false : DEPENDENCY_SHAPED_RULES.includes(`ts${code[1] ?? ''}`);
}

function outsideRange(finding: NewFinding, patch: PatchRange): boolean {
  return finding.line < patch.startLine || finding.line > patch.endLine;
}

/**
 * Decide whether a failed verification is dependency-shaped, and if so what it points at.
 *
 * Returns null — meaning "do not widen" — for every settled or unattributable outcome:
 *
 *  - a **verified** or **skipped** verdict: nothing failed, or nothing ran to fail;
 *  - a **parse failure** (`syntaxOk: false`): the patch is malformed rather than incomplete, which is
 *    a different defect with a different owner (`balanced-scope.ts` widens for unbalanced delimiters);
 *  - **no verifier evidence**: without findings there is nothing to attribute the failure to, and
 *    widening on a hunch would enlarge the blast radius for no stated reason.
 */
export function detectDependentFailure(
  report: VerificationReport,
  patch: PatchRange,
): DependentFailure | null {
  if (report.verdict === 'verified' || report.verdict === 'skipped') return null;
  if (!report.syntaxOk) return null;

  const findings = report.newFindings ?? [];
  if (findings.length === 0) return null;

  // Errors the patch introduced somewhere ELSE in the file. The patch range cannot reach them by
  // definition, so these are dependent whatever their rule.
  const outside = findings.filter((f) => outsideRange(f, patch));
  // Errors at the patch site that are about a symbol rather than about the code written there — the
  // prerequisite is a declaration the range does not contain.
  const shaped = findings.filter((f) => isDependencyShapedRule(f.ruleId, f.message));

  if (outside.length === 0 && shaped.length === 0) return null;

  const evidence = outside.length > 0 ? outside : shaped;
  const prerequisiteLines = [...new Set(outside.map((f) => f.line))].sort((a, b) => a - b);
  const reason =
    outside.length > 0
      ? `The patch leaves ${String(outside.length)} unresolved problem(s) outside the code it replaces ` +
        `(line(s) ${prerequisiteLines.join(', ')}), so no change confined to lines ` +
        `${String(patch.startLine)}-${String(patch.endLine)} can make the file compile.`
      : `The patch still fails on ${shaped[0]?.ruleId ?? 'a type error'}, which is caused by a ` +
        `declaration outside the code it replaces, so the prerequisite edit has to be part of the ` +
        `same repair.`;

  return { prerequisiteLines, evidence, reason };
}
