import type { Finding } from '@fixora/shared-types';

import type { BenchmarkCase, ExpectedFinding } from './schema.js';

/**
 * Matching actual findings against expected ones.
 *
 * The matching rule decides what the accuracy number means, so it is stated explicitly rather than
 * left implicit in a comparison function.
 *
 * **Identity is (file, ruleId).** Two findings are the same finding when the same rule fires in the
 * same file. Line is then compared as an *attribute*, not part of identity — because a rule that
 * fires on the right problem at the wrong line is a different (and much less severe) defect than a
 * rule that does not fire at all. Folding line into identity would report one miss plus one false
 * positive for what is really one off-by-one, which inflates both error rates and hides the real
 * failure mode.
 *
 * Where a case expects the same rule twice in one file, expectations are consumed in line order and
 * matched to actuals in line order, so duplicates pair up nearest-first.
 */

export type MatchOutcome =
  /** Expected, found, every compared attribute agreed. */
  | { kind: 'true-positive'; expected: ExpectedFinding; actual: Finding }
  /**
   * Expected and found, but an attribute disagreed. Counted as a true positive for detection
   * (the rule DID fire on the right problem) and reported separately as an attribute mismatch,
   * because conflating "wrong line" with "not detected" would misdescribe the engine's behaviour.
   */
  | {
      kind: 'attribute-mismatch';
      expected: ExpectedFinding;
      actual: Finding;
      mismatches: AttributeMismatch[];
    }
  /** Expected, never reported. */
  | { kind: 'false-negative'; expected: ExpectedFinding }
  /** Reported, not expected, not ignored. */
  | { kind: 'false-positive'; actual: Finding }
  /** Reported and explicitly out of this case's scope (`ignoreRules`). Scored as nothing. */
  | { kind: 'ignored'; actual: Finding };

export type AttributeMismatch = {
  attribute: 'line' | 'column' | 'severity' | 'analyzer' | 'repairAvailable';
  expected: string;
  actual: string;
};

const key = (file: string, ruleId: string): string => `${file}::${ruleId}`;

function compareAttributes(expected: ExpectedFinding, actual: Finding): AttributeMismatch[] {
  const out: AttributeMismatch[] = [];
  if (actual.location.startLine !== expected.line) {
    out.push({
      attribute: 'line',
      expected: String(expected.line),
      actual: String(actual.location.startLine),
    });
  }
  // Column is compared only when the expectation declares one. Analyzers disagree on whether a
  // whole-statement violation starts at the statement or at column 1, and inventing an expectation
  // to compare against would manufacture failures that say nothing about accuracy.
  if (expected.column !== undefined && actual.location.startCol !== expected.column) {
    out.push({
      attribute: 'column',
      expected: String(expected.column),
      actual: String(actual.location.startCol),
    });
  }
  if (actual.severity !== expected.severity) {
    out.push({ attribute: 'severity', expected: expected.severity, actual: actual.severity });
  }
  if (actual.source !== expected.analyzer) {
    out.push({ attribute: 'analyzer', expected: expected.analyzer, actual: actual.source });
  }
  if (actual.fixable !== expected.repairAvailable) {
    out.push({
      attribute: 'repairAvailable',
      expected: String(expected.repairAvailable),
      actual: String(actual.fixable),
    });
  }
  return out;
}

export function matchFindings(
  benchmark: BenchmarkCase,
  actuals: readonly Finding[],
): MatchOutcome[] {
  const ignored = new Set(benchmark.ignoreRules);
  const outcomes: MatchOutcome[] = [];

  // Bucket actuals by identity, each bucket sorted by line so duplicates pair nearest-first.
  const buckets = new Map<string, Finding[]>();
  const inScope: Finding[] = [];
  for (const actual of actuals) {
    if (ignored.has(actual.ruleId)) {
      outcomes.push({ kind: 'ignored', actual });
      continue;
    }
    inScope.push(actual);
    const k = key(actual.location.file, actual.ruleId);
    const bucket = buckets.get(k) ?? [];
    bucket.push(actual);
    buckets.set(k, bucket);
  }
  for (const bucket of buckets.values()) {
    bucket.sort((a, b) => a.location.startLine - b.location.startLine);
  }

  const consumed = new Set<Finding>();
  const expectedInOrder = [...benchmark.expected].sort((a, b) => a.line - b.line);

  for (const expected of expectedInOrder) {
    const bucket = buckets.get(key(expected.file, expected.ruleId)) ?? [];
    // Nearest unconsumed actual by line — so two expectations for the same rule take the two
    // reported instances in the order a reader would pair them.
    let best: Finding | undefined;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const candidate of bucket) {
      if (consumed.has(candidate)) continue;
      const distance = Math.abs(candidate.location.startLine - expected.line);
      if (distance < bestDistance) {
        best = candidate;
        bestDistance = distance;
      }
    }

    if (best === undefined) {
      outcomes.push({ kind: 'false-negative', expected });
      continue;
    }
    consumed.add(best);
    const mismatches = compareAttributes(expected, best);
    outcomes.push(
      mismatches.length === 0
        ? { kind: 'true-positive', expected, actual: best }
        : { kind: 'attribute-mismatch', expected, actual: best, mismatches },
    );
  }

  for (const actual of inScope) {
    if (!consumed.has(actual)) outcomes.push({ kind: 'false-positive', actual });
  }

  return outcomes;
}
