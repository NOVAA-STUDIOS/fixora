import type { NewFinding, VerificationReport } from './ai.js';

/**
 * Detecting a **lint-only** verification failure — one worth one more targeted attempt before the
 * patch is handed to the user as unappliable.
 *
 * A repair that is syntactically valid, type-correct, and resolves the reported problem can still be
 * rejected for something like `prefer-const` or `no-unused-vars` on a line it touched. That is a real
 * regression and the gate is right to fail it — but it is also the most trivially fixable kind, and
 * spending the user's Accept on it is a poor trade when one more targeted attempt usually clears it.
 *
 * ## This does not relax anything
 *
 * A `true` here buys exactly one more generation, verified by the identical pipeline. It never
 * changes a verdict, never enables Apply, and never suppresses a finding. If the retry also fails,
 * the last verdict stands and Apply stays disabled with its reason — the same outcome as before,
 * reached one attempt later.
 *
 * ## What can never qualify
 *
 * The boundary is the whole safety argument, so it is drawn by SOURCE and is deliberately narrow:
 *
 *  - **A parse failure** never qualifies, whatever the findings say. Malformed code is not a lint
 *    problem, and `syntaxOk: false` is checked first.
 *  - **Type checkers** (`tsc`, `mypy`) never qualify. A type error is a statement about whether the
 *    program is correct.
 *  - **`go-vet`, `semgrep`, `complexity`** never qualify. Vet findings are semantic, semgrep findings
 *    are frequently security, and neither is a formatting preference.
 *  - **A mixed failure never qualifies.** If even one new finding comes from a non-lint source, the
 *    failure is treated as semantic in full — the lint findings alongside it are not evidence that
 *    the type error is harmless.
 */

/**
 * Sources whose findings are lint diagnostics.
 *
 * ESLint and Ruff are linters: their findings are about style, idiom and local code smells. Every
 * other analyzer in the engine makes a claim about program correctness, so none of them is here.
 */
const LINT_SOURCES: readonly string[] = ['eslint', 'ruff'];

export function isLintSource(source: string): boolean {
  return LINT_SOURCES.includes(source.toLowerCase());
}

export interface LintOnlyFailure {
  /** The lint findings to target — exactly what the retry is asked to fix, and nothing else. */
  readonly diagnostics: readonly NewFinding[];
  /** Human-readable summary, for the log and the re-ask. */
  readonly reason: string;
}

/**
 * Decide whether a failed verification is lint-only.
 *
 * Returns null — meaning "do not retry for lint" — for every outcome that is settled, unattributable,
 * or not purely a lint problem. The caller may still run its ordinary re-ask; this only decides
 * whether the *targeted lint* attempt is warranted.
 */
export function detectLintOnlyFailure(report: VerificationReport): LintOnlyFailure | null {
  // A patch that does not parse is a different defect with a different owner. Checked first so no
  // combination of findings can talk its way past a broken file.
  if (!report.syntaxOk) return null;
  if (report.verdict !== 'regression') return null;

  const findings = report.newFindings ?? [];
  // No evidence means nothing to target: a retry would be a re-roll, not a correction.
  if (findings.length === 0) return null;

  // EVERY new finding must be lint. One type error among them makes the whole failure semantic.
  if (!findings.every((f) => isLintSource(f.source))) return null;

  const rules = [...new Set(findings.map((f) => f.ruleId))];
  return {
    diagnostics: findings,
    reason:
      `The patch is syntactically valid and type-correct, and the only new problems are lint ` +
      `diagnostics (${rules.slice(0, 4).join(', ')}${rules.length > 4 ? ', …' : ''}).`,
  };
}
