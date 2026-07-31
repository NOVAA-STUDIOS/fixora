import type { Finding } from '@fixora/shared-types';

import { isDelimiterRule } from './balanced-scope.js';
import { extractUndefinedName, isUndefinedNameRule } from './symbol-resolution.js';

/**
 * Root-cause grouping for Advanced Repair — pure, deterministic, and calls no model.
 *
 * Grouping is not a place to spend trust; verification is. So every claim this file makes is narrow
 * and checkable, never a generic "these seem related" guess:
 *
 *  - **Identifier groups** — the textbook case ("missing import → 20 diagnostics disappear"). Reuses
 *    `extractUndefinedName`/`isUndefinedNameRule`, already shipped for context-aware symbol
 *    resolution: findings on TS2304/F821 that name the SAME missing identifier are one group,
 *    because they are, unambiguously, the same problem reported N times.
 *  - **Scope groups** — findings whose resolved scope overlaps, using the exact precedence
 *    `ai-service.ts` already uses to pick a repair target (`enclosingRange` ?? `enclosingSymbol` ??
 *    the finding's own location), ranked by a small priority table (syntax/parse errors first,
 *    since nothing else can be understood until the file parses; undefined-name next; everything
 *    else by severity).
 *
 * What this deliberately does NOT claim: cross-rule causality ("this type error was probably caused
 * by that missing import elsewhere"). Only same-identifier and same-scope relationships are ever
 * asserted. Overclaiming a root cause is the unsafe move a "flagship" feature is most tempted to
 * make, and it is exactly what this module refuses to do.
 *
 * **The target range is always the root cause's own scope — never a union spanning scattered
 * usages.** A missing import used in five places does not need five locations rewritten; it needs
 * one import line added where the root-cause finding already lives. The other four are `affected`,
 * reported to the model as context, and checked afterward by re-analysis (the existing verification
 * chokepoint already re-analyzes the whole file) — never spliced. This is what keeps Advanced Repair
 * from ever blindly rewriting more than the fix requires.
 */

export interface ScopeRange {
  readonly startLine: number;
  readonly endLine: number;
}

export interface RootCauseGroup {
  readonly rootCause: Finding;
  /** Group members whose scope is CONTAINED in the root cause's range — genuinely rewritten by the patch. */
  readonly mergeable: readonly Finding[];
  /** Group members outside the splice range — reported as context, checked by re-analysis afterward. */
  readonly affected: readonly Finding[];
  /** The root cause's own resolved scope, unioned only with `mergeable` members. Never wider than that. */
  readonly targetRange: ScopeRange;
  /** How this group was formed. Shown in the UI so "why grouped" is never a black box. */
  readonly basis: 'identifier' | 'scope' | 'singleton';
  /** `affected.length` — an ESTIMATE. Only verification, after the fact, confirms what actually cleared. */
  readonly estimatedDiagnosticsRemoved: number;
}

/**
 * The same target-resolution precedence `ai-service.ts` uses for a single finding, exported here as
 * a pure function so grouping and the live service can never quietly disagree about what "a
 * finding's scope" means. `enclosingRange` is always >= a complete statement, so the result always
 * compiles; the finding's own location is the last resort, reached only when analysis produced no
 * scope at all (e.g. the file did not parse).
 */
export function scopeRangeOf(finding: Finding): ScopeRange {
  const range = finding.evidence.enclosingRange;
  if (range) return { startLine: range.startLine, endLine: range.endLine };
  const symbol = finding.evidence.enclosingSymbol;
  if (symbol) return { startLine: symbol.location.startLine, endLine: symbol.location.endLine };
  return { startLine: finding.location.startLine, endLine: finding.location.endLine };
}

function overlaps(a: ScopeRange, b: ScopeRange): boolean {
  return a.startLine <= b.endLine && b.startLine <= a.endLine;
}

function contains(outer: ScopeRange, inner: ScopeRange): boolean {
  return outer.startLine <= inner.startLine && inner.endLine <= outer.endLine;
}

function union(a: ScopeRange, b: ScopeRange): ScopeRange {
  return { startLine: Math.min(a.startLine, b.startLine), endLine: Math.max(a.endLine, b.endLine) };
}

/**
 * A defensible proxy for "fix this first", not a certainty. Lower ranks first: nothing else can be
 * understood until the file parses, so a syntax error always outranks everything; an undefined name
 * is the next most likely single cause of a cluster; everything else falls back to severity, which
 * is at least the analyzer's own judgement rather than an invented one.
 */
function priorityRank(finding: Finding): number {
  if (isDelimiterRule(finding.ruleId)) return 0;
  if (isUndefinedNameRule(finding.ruleId)) return 1;
  return finding.severity === 'error' ? 2 : finding.severity === 'warning' ? 3 : 4;
}

function pickRootCause(members: readonly Finding[], fallback: Finding): Finding {
  // Stable: ties keep the earliest-appearing finding, so grouping is deterministic across runs for
  // the same finding list, which is what makes it testable and reproducible.
  const sorted = [...members].sort((a, b) => {
    const rank = priorityRank(a) - priorityRank(b);
    if (rank !== 0) return rank;
    return a.location.startLine - b.location.startLine;
  });
  // `fallback` (the caller's own first member) is used only if `members` were somehow empty, which
  // cannot happen at either call site — it exists so the return type needs no assertion.
  return sorted[0] ?? fallback;
}

function finalizeGroup(members: readonly Finding[], basis: RootCauseGroup['basis']): RootCauseGroup {
  const first = members[0];
  if (first === undefined) throw new Error('finalizeGroup requires at least one finding');
  const rootCause = members.length === 1 ? first : pickRootCause(members, first);
  const rootRange = scopeRangeOf(rootCause);
  const others = members.filter((f) => f !== rootCause);

  // A `manual` finding is one the analyzer already refused to auto-classify. Absorbing it into a
  // coordinated patch would launder that refusal — the exact rule `related-scope` mode already
  // enforces for its own merge set, applied here too. Excluded from `mergeable` in EITHER strategy.
  const eligible = others.filter((f) => f.repair !== 'manual');

  // Identifier and scope groups earn different levels of trust for widening the target, because
  // they are different claims:
  //
  //  - **Identifier members are independent occurrences that happen to share a name** — nothing
  //    proves the code BETWEEN them is safe to rewrite. Only members already contained in the root
  //    cause's own scope merge; everything else is reported as context and left unspliced.
  //  - **Scope members were grouped BECAUSE their ranges transitively overlap** — that overlap IS
  //    the proof the code between them is one contiguous, already-adjacent region, so unioning the
  //    whole group into the target is the coherent, non-fragmented patch the design calls for
  //    rather than an unproven guess.
  const mergeable =
    basis === 'identifier'
      ? eligible.filter((f) => contains(rootRange, scopeRangeOf(f)))
      : eligible;
  const affected = others.filter((f) => !mergeable.includes(f));

  const targetRange = mergeable.reduce((range, f) => union(range, scopeRangeOf(f)), rootRange);

  return {
    rootCause,
    mergeable,
    affected,
    targetRange,
    basis: members.length === 1 ? 'singleton' : basis,
    estimatedDiagnosticsRemoved: affected.length,
  };
}

/**
 * Group every finding in a file by probable root cause.
 *
 * Every finding appears in EXACTLY one group's `rootCause`/`mergeable`/`affected` — nothing is
 * dropped and nothing is double-counted, which is what makes "repair everything Advanced Repair
 * found" a meaningful, checkable claim rather than a best-effort pass over a subset.
 */
export function groupByRootCause(findings: readonly Finding[]): RootCauseGroup[] {
  const remaining = new Set(findings);
  const groups: RootCauseGroup[] = [];

  // Pass 1: identifier groups. Narrowest, most defensible claim — do it first so a finding is never
  // pulled into a looser scope group when a precise identifier match already accounts for it.
  const byIdentifier = new Map<string, Finding[]>();
  for (const finding of findings) {
    const name = extractUndefinedName(finding.ruleId, finding.message);
    if (name === null) continue;
    const key = `${finding.ruleId}:${name}`;
    const bucket = byIdentifier.get(key);
    if (bucket === undefined) byIdentifier.set(key, [finding]);
    else bucket.push(finding);
  }
  for (const bucket of byIdentifier.values()) {
    if (bucket.length < 2) continue; // a lone occurrence has nothing to coordinate — falls through to pass 2
    groups.push(finalizeGroup(bucket, 'identifier'));
    for (const f of bucket) remaining.delete(f);
  }

  // Pass 2: scope groups over whatever pass 1 left — TRANSITIVE overlap, so three findings sharing
  // one function are one group even when not every pair touches directly (A overlaps B, B overlaps
  // C, A and C do not). The cumulative range is expanded and re-scanned until nothing new joins —
  // a fixed point, not a single pass, which is what makes the transitivity real rather than claimed.
  const pool = [...remaining];
  const claimed = new Set<Finding>();
  for (const seed of pool) {
    if (claimed.has(seed)) continue;
    let members = [seed];
    let range = scopeRangeOf(seed);
    for (;;) {
      const next = pool.filter(
        (f) => !claimed.has(f) && !members.includes(f) && overlaps(range, scopeRangeOf(f)),
      );
      if (next.length === 0) break;
      members = [...members, ...next];
      range = next.reduce((r, f) => union(r, scopeRangeOf(f)), range);
    }
    for (const m of members) claimed.add(m);
    groups.push(finalizeGroup(members, 'scope'));
  }

  return groups;
}
