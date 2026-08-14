import type { Finding } from '@fixora/shared-types';

/**
 * Cross-analyzer deduplication.
 *
 * Two DIFFERENT tools can flag the same visible defect — a type error tsc reports and an ESLint
 * rule catching the same misuse, for instance — and nothing before this collapsed them: each
 * analyzer's stream is independent (`engine.ts`'s `merge()`), so the panel showed both as separate
 * problems. Deliberately NOT the same identity `verification/patch.ts`'s `verificationSignature`
 * uses (source + rule + symbol/snippet) — that scheme exists to track ONE analyzer's finding
 * across a before/after diff, and correctly treats a different rule id as a different finding. This
 * one answers a different question: "do these look like the same problem to a person reading the
 * file", which file + line + category answers well enough without conflating genuinely distinct
 * issues that merely share a line (e.g. an unused import AND a missing return type on the same
 * line are both real, both worth keeping).
 *
 * A pure function, not wired into `engine.ts`'s streaming generator: `analyzeWorkspace` yields
 * findings incrementally specifically so the panel fills as the fastest analyzer finishes rather
 * than waiting on the slowest (its own docstring). Buffering the whole run to dedup before yielding
 * anything would undo that. Callers who already hold the full set — main's findings repository,
 * a benchmark run, a test — call this after collecting it.
 */

export interface DedupResult {
  /** One finding per (file, line, category) group — the highest-confidence member of each. */
  readonly findings: readonly Finding[];
  /** How many findings were discarded as duplicates of one already kept. */
  readonly duplicatesRemoved: number;
}

function dedupKey(finding: Finding): string {
  return `${finding.location.file}:${String(finding.location.startLine)}:${finding.category}`;
}

/**
 * Collapse findings that share (file, startLine, category) down to their highest-confidence member.
 * A tie keeps whichever was seen first — stable, not arbitrary, since callers typically pass
 * findings in analyzer-registration order.
 */
export function dedupeFindings(findings: readonly Finding[]): DedupResult {
  const bestByKey = new Map<string, Finding>();
  let duplicatesRemoved = 0;

  for (const finding of findings) {
    const key = dedupKey(finding);
    const existing = bestByKey.get(key);
    if (existing === undefined) {
      bestByKey.set(key, finding);
      continue;
    }
    duplicatesRemoved += 1;
    if (finding.confidence > existing.confidence) bestByKey.set(key, finding);
  }

  return { findings: [...bestByKey.values()], duplicatesRemoved };
}
