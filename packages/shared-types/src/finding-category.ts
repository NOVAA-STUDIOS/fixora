import type { Finding } from './analysis.js';
import { classifyDiagnostic } from './diagnostic-classifier.js';
import { isRepairAttemptable, repairStateFor } from './repair-support.js';

/**
 * How a finding is presented in the Problems panel — the answer to "what am I expected to do with
 * this?", which is a different question from "can the engine repair it?".
 *
 * This is a PRESENTATION layer over `repairStateFor`. It decides nothing about repairability and
 * cannot: the repair state is computed first and every category is derived from it. That ordering is
 * deliberate and load-bearing — it makes it structurally impossible for a classification change to
 * take repair away from a finding that the engine can actually fix.
 *
 *  - `repairable`     — the engine can produce a verified fix (deterministic or AI).
 *  - `configuration`  — a project/environment problem. No edit to this file resolves it, so it
 *                       carries the exact command instead of a Repair button.
 *  - `manual-review`  — a human must decide. Either the rule has no knowable fix, or the repair
 *                       engine does not handle this file type.
 *  - `information`    — informational severity with nothing to act on automatically.
 */
export type FindingCategory = 'repairable' | 'configuration' | 'manual-review' | 'information';

/** Display order: what you can act on first, what is merely noted last. */
export const FINDING_CATEGORY_ORDER: readonly FindingCategory[] = [
  'repairable',
  'manual-review',
  'configuration',
  'information',
];

export const FINDING_CATEGORY_LABEL: Record<FindingCategory, string> = {
  repairable: 'Repairable',
  'manual-review': 'Manual Review',
  configuration: 'Configuration',
  information: 'Information',
};

export interface FindingClassification {
  readonly category: FindingCategory;
  /** The heading shown above the reason, e.g. "Configuration Issue". Never generic. */
  readonly title: string;
  /** Why this finding is in this category — always specific, never "Repair is disabled". */
  readonly reason: string;
  /** The exact command or edit that resolves it, when one is knowable. */
  readonly suggestedFix?: string;
  /** What the developer should do next. Present for every non-repairable category. */
  readonly nextStep?: string;
}

/**
 * Classify a finding for display.
 *
 * The precedence is the contract, and `repairable` is tested FIRST on purpose: a finding the engine
 * can fix is never reclassified into an advisory bucket, whatever its severity. An `info`-severity
 * finding that ships a deterministic autofix stays Repairable.
 */
export function classifyFinding(finding: Finding): FindingClassification {
  const state = repairStateFor(finding);

  // 1. Repairable wins over everything. See the note above.
  if (isRepairAttemptable(state)) {
    return {
      category: 'repairable',
      title: 'Repairable',
      reason:
        state === 'repairable'
          ? 'A verified fix is available for this finding — no model needed.'
          : 'Fixora can generate a fix for this finding and verify it before you apply it.',
    };
  }

  // 2. Configuration — the classifier already knows the cause AND the command.
  if (state === 'config-issue') {
    const diagnosis = finding.source === 'tsc' ? classifyDiagnostic(finding) : null;
    return {
      category: 'configuration',
      title: 'Configuration Issue',
      reason:
        diagnosis?.reason ??
        'This is a project or environment problem rather than a defect in this file.',
      ...(diagnosis === null ? {} : { suggestedFix: diagnosis.fix }),
      nextStep:
        'Run the command above in your project, then re-run analysis. No edit to this file can resolve it.',
    };
  }

  // 3. The repair engine does not handle this file type at all.
  if (state === 'unsupported') {
    return {
      category: 'manual-review',
      title: 'Unsupported',
      reason:
        'The current repair engine does not support this diagnostic — Fixora does not repair this file type yet.',
      nextStep: 'Fix this one by hand; the finding above tells you what the tool objected to.',
    };
  }

  // 4. Informational severity with nothing automatic to do. Checked AFTER repairability, so a
  //    fixable `info` finding is never demoted out of Repairable.
  if (finding.severity === 'info') {
    return {
      category: 'information',
      title: 'Information',
      reason:
        'Reported for awareness. It is not an error and there is nothing for the repair engine to change.',
      nextStep: 'No action required. Use Explain if you want the detail behind it.',
    };
  }

  // 5. `manual-only`: the analyzer judged that the correct change is a human decision.
  return {
    category: 'manual-review',
    title: 'Manual Review',
    reason:
      'More than one valid repair exists for this finding, and choosing between them changes what the program does — applying one automatically could alter behaviour.',
    nextStep:
      'Decide which behaviour you intend, then make the change yourself. Explain can walk through the options.',
  };
}

/** Counts per category, in display order. Used by the Problems panel's group bar. */
export function countByCategory(
  findings: readonly Finding[],
): Record<FindingCategory, number> {
  const counts: Record<FindingCategory, number> = {
    repairable: 0,
    'manual-review': 0,
    configuration: 0,
    information: 0,
  };
  for (const finding of findings) counts[classifyFinding(finding).category] += 1;
  return counts;
}

/** One file type and how many findings sit in files of that type. */
export interface ExtensionCount {
  /** Lower-case, no leading dot — `ts`, `py`. `?` when the path has no usable extension. */
  readonly extension: string;
  readonly count: number;
}

/** Files with no extension at all, or a name that is only a dot-suffix (`.gitignore`). */
const NO_EXTENSION = '?';

/**
 * The extension of a finding's file, normalised for display.
 *
 * Takes the LAST dot segment, so `component.test.ts` counts as `ts` rather than as its own type —
 * the question the header answers is "which languages are these problems in", and a test file is
 * still TypeScript. A dotfile like `.gitignore` has no extension despite containing a dot, which is
 * why the dot must be found past the first character of the basename.
 */
function extensionOf(path: string): string {
  const basename = path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1);
  const dot = basename.lastIndexOf('.');
  if (dot <= 0 || dot === basename.length - 1) return NO_EXTENSION;
  return basename.slice(dot + 1).toLowerCase();
}

/**
 * Counts per file type, most problems first — the Problems header's breakdown.
 *
 * Only types with at least one finding appear, so the header shows nothing at all for a clean
 * workspace rather than a row of zeroes. Ties break alphabetically, because a count-only sort leaves
 * equal types swapping places between runs for no reason the user can see.
 */
export function countByExtension(findings: readonly Finding[]): ExtensionCount[] {
  const counts = new Map<string, number>();
  for (const finding of findings) {
    const extension = extensionOf(finding.location.file);
    counts.set(extension, (counts.get(extension) ?? 0) + 1);
  }
  return [...counts]
    .map(([extension, count]) => ({ extension, count }))
    .sort((a, b) => b.count - a.count || a.extension.localeCompare(b.extension));
}

/** Sort key so the list clusters by category without changing which findings are shown. */
export function categoryRank(finding: Finding): number {
  return FINDING_CATEGORY_ORDER.indexOf(classifyFinding(finding).category);
}
