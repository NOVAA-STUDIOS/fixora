import type { AiProposal } from '@fixora/shared-types';

/**
 * The four validation badges shown on a repair, derived honestly from what actually ran.
 *
 * The rule this module exists to enforce: **never show a green check for a validator that did not
 * run.** Three of the seven supported languages (JSON, CSS, HTML) have no linter and no type checker
 * in this stack at all, so a "✓ Lint ✓ Type" row on a CSS repair would be a claim about checks that
 * do not exist — exactly the class of overclaim beta audit A5 was raised to remove.
 *
 * There is a second, subtler honesty problem. `VerificationReport.ran` is not a list of tools that
 * executed; it is derived in `patch.ts` from the SOURCES of the findings involved:
 *
 *     const sources = new Set(['syntax']);
 *     for (const f of [...originalFindings, ...patchedFindings]) sources.add(f.source);
 *
 * So a file that ESLint linted cleanly contributes no `eslint` entry — "ran and found nothing" and
 * "never ran" are indistinguishable from this data. Rather than guess, an absent validator is
 * reported as `not-run`. A check we cannot prove happened is not a check we may claim passed.
 */

export type ValidationName = 'Syntax' | 'Lint' | 'Type' | 'Regression';

export interface ValidationBadge {
  name: ValidationName;
  /** `not-run` is a first-class outcome, not a failure — it means "no such check for this file". */
  status: 'pass' | 'fail' | 'not-run';
  /** One sentence naming what was or was not checked. Never a bare label. */
  detail: string;
}

type Report = Extract<AiProposal, { profile: 'repair' }>['verification'];

/** Which finding sources count as linting, and which as type checking, per language family. */
const LINT_SOURCES = new Set(['eslint', 'ruff', 'go-vet']);
const TYPE_SOURCES = new Set(['tsc', 'mypy']);

/** Extensions whose language has a linter wired into this stack at all. */
const HAS_LINTER = new Set([
  'ts',
  'tsx',
  'mts',
  'cts',
  'js',
  'jsx',
  'mjs',
  'cjs',
  'py',
  'pyi',
  'go',
]);
/** Extensions whose language has a type checker wired into this stack at all. */
const HAS_TYPE_CHECKER = new Set(['ts', 'tsx', 'mts', 'cts', 'py', 'pyi', 'go']);

function extensionOf(file: string): string {
  return file.split('.').pop()?.toLowerCase() ?? '';
}

/**
 * Was a validator of this kind actually involved in the verification?
 *
 * `true` only when a source of that kind appears in `ran`, which (per the note above) happens only
 * when it produced at least one finding on either side of the patch. Anything else is unknown, and
 * unknown is reported as not-run.
 */
function ran(report: Report, sources: Set<string>): boolean {
  return report.ran.some((tool) => sources.has(tool));
}

/** New findings the patch introduced, from validators of the given kind. */
function newFrom(report: Report, sources: Set<string>): number {
  return (report.newFindings ?? []).filter((f) => sources.has(f.source)).length;
}

export function validationBadges(
  proposal: Extract<AiProposal, { profile: 'repair' }>,
): ValidationBadge[] {
  const report = proposal.verification;
  const ext = extensionOf(proposal.target.file);

  // Syntax always runs: the worker re-parses the patched file with its own grammar, for every
  // supported language including the three with no other tooling. This is the one check that is
  // always meaningful, which is why it leads.
  const syntax: ValidationBadge = report.syntaxOk
    ? { name: 'Syntax', status: 'pass', detail: 'The patched file parses cleanly.' }
    : {
        name: 'Syntax',
        status: 'fail',
        detail: 'The patched file does not parse — applying it would break the file.',
      };

  const lint: ValidationBadge = !HAS_LINTER.has(ext)
    ? {
        name: 'Lint',
        status: 'not-run',
        detail: 'No linter ships for this file type, so nothing was linted.',
      }
    : !ran(report, LINT_SOURCES)
      ? {
          name: 'Lint',
          status: 'not-run',
          detail: 'No lint results were involved in this verification.',
        }
      : newFrom(report, LINT_SOURCES) > 0
        ? {
            name: 'Lint',
            status: 'fail',
            detail: `The patch introduces ${String(newFrom(report, LINT_SOURCES))} new lint problem(s).`,
          }
        : { name: 'Lint', status: 'pass', detail: 'No new lint problems in this file.' };

  const type: ValidationBadge = !HAS_TYPE_CHECKER.has(ext)
    ? {
        name: 'Type',
        status: 'not-run',
        detail: 'No type checker ships for this file type, so nothing was type-checked.',
      }
    : !ran(report, TYPE_SOURCES)
      ? {
          name: 'Type',
          status: 'not-run',
          detail: 'No type-check results were involved in this verification.',
        }
      : newFrom(report, TYPE_SOURCES) > 0
        ? {
            name: 'Type',
            status: 'fail',
            detail: `The patch introduces ${String(newFrom(report, TYPE_SOURCES))} new type error(s).`,
          }
        : { name: 'Type', status: 'pass', detail: 'No new type errors in this file.' };

  // Regression is the whole-report question — did ANY new problem appear, from any source — so it is
  // meaningful even for a language with no linter, where "no new findings" still means something.
  // Only claimed when the file parses: on a parse failure the analyzers cannot have run meaningfully,
  // so a "no new problems" claim would be an artifact of nothing having been checked.
  const regression: ValidationBadge = !report.syntaxOk
    ? {
        name: 'Regression',
        status: 'not-run',
        detail: 'Not checked — the patched file does not parse.',
      }
    : report.newFindingCount > 0
      ? {
          name: 'Regression',
          status: 'fail',
          detail: `The patch introduces ${String(report.newFindingCount)} new problem(s) in this file.`,
        }
      : {
          name: 'Regression',
          status: 'pass',
          detail: 'Re-analyzed after the change: no new problems in this file.',
        };

  return [syntax, lint, type, regression];
}
