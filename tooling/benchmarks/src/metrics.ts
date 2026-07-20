import type { MatchOutcome } from './match.js';

/**
 * The accuracy maths.
 *
 * Two rules govern this file, and both exist to stop a number from being flattering:
 *
 *  1. **A metric with no data is `null`, never `0` and never `100`.** An empty denominator is not a
 *     score; it is an absence of evidence. `null` propagates to the report as "not measured", which
 *     is the truth. A zero would read as catastrophic and a hundred as perfect, and both would be
 *     inventions.
 *  2. **Unsupported cases never enter the maths.** HTML/CSS/JSON have no analyzer, so scoring them
 *     would either produce a fake 0% (implying a broken analyzer rather than an absent one) or,
 *     worse, a fake 100% from a vacuous "expected nothing, found nothing". They are counted and
 *     reported separately as a gap.
 */

export type Counts = {
  truePositives: number;
  /** Detected, but an attribute (line/column/severity/analyzer/repair) disagreed. */
  attributeMismatches: number;
  falsePositives: number;
  falseNegatives: number;
  /** Out of scope for the case via `ignoreRules`. Excluded from every metric. */
  ignored: number;
};

export const emptyCounts = (): Counts => ({
  truePositives: 0,
  attributeMismatches: 0,
  falsePositives: 0,
  falseNegatives: 0,
  ignored: 0,
});

export function countOutcomes(outcomes: readonly MatchOutcome[]): Counts {
  const counts = emptyCounts();
  for (const o of outcomes) {
    switch (o.kind) {
      case 'true-positive':
        counts.truePositives += 1;
        break;
      case 'attribute-mismatch':
        // Detection succeeded — the rule fired on the right problem. The attribute disagreement is
        // reported on its own axis rather than being laundered into the detection numbers.
        counts.truePositives += 1;
        counts.attributeMismatches += 1;
        break;
      case 'false-positive':
        counts.falsePositives += 1;
        break;
      case 'false-negative':
        counts.falseNegatives += 1;
        break;
      case 'ignored':
        counts.ignored += 1;
        break;
    }
  }
  return counts;
}

export function addCounts(a: Counts, b: Counts): Counts {
  return {
    truePositives: a.truePositives + b.truePositives,
    attributeMismatches: a.attributeMismatches + b.attributeMismatches,
    falsePositives: a.falsePositives + b.falsePositives,
    falseNegatives: a.falseNegatives + b.falseNegatives,
    ignored: a.ignored + b.ignored,
  };
}

/** Every rate is a fraction in [0,1], or `null` when its denominator is zero. */
export type Metrics = {
  precision: number | null;
  recall: number | null;
  f1: number | null;
  /**
   * TP / (TP + FP + FN).
   *
   * Deliberately NOT the textbook (TP+TN)/(total) accuracy, because there is no meaningful count of
   * true negatives here: a "true negative" would be every line of every file where no analyzer fired
   * and none should have, which is an arbitrary number that can be inflated without limit by adding
   * blank lines. This form — the Jaccard index over findings — cannot be gamed that way.
   */
  accuracy: number | null;
  /** FP / (TP + FP) — of everything reported, what share was wrong. */
  falsePositiveRate: number | null;
  /** FN / (TP + FN) — of everything that should have been reported, what share was missed. */
  falseNegativeRate: number | null;
  /** Attribute mismatches / detections — how often a correct detection got a detail wrong. */
  attributeErrorRate: number | null;
};

const ratio = (numerator: number, denominator: number): number | null =>
  denominator === 0 ? null : numerator / denominator;

export function computeMetrics(counts: Counts): Metrics {
  const { truePositives: tp, falsePositives: fp, falseNegatives: fn } = counts;
  const precision = ratio(tp, tp + fp);
  const recall = ratio(tp, tp + fn);
  const f1 =
    precision === null || recall === null || precision + recall === 0
      ? null
      : (2 * precision * recall) / (precision + recall);

  return {
    precision,
    recall,
    f1,
    accuracy: ratio(tp, tp + fp + fn),
    falsePositiveRate: ratio(fp, tp + fp),
    falseNegativeRate: ratio(fn, tp + fn),
    attributeErrorRate: ratio(counts.attributeMismatches, tp),
  };
}

/** Render a rate for humans. `null` is "n/a", never a number — see rule 1 above. */
export function formatRate(value: number | null): string {
  return value === null ? 'n/a' : `${(value * 100).toFixed(1)}%`;
}
