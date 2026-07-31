import type { Finding, Location, RepairStrategy, Severity } from '@fixora/shared-types';
import { describe, expect, it } from 'vitest';

import { groupByRootCause, scopeRangeOf } from './root-cause-grouping.js';

/**
 * Root-cause grouping. Two properties matter more than the grouping itself:
 *
 *  - **Every finding appears in exactly one group.** Nothing dropped, nothing double-counted — the
 *    thing that makes "Advanced Repair looked at everything" a checkable claim.
 *  - **The target range never exceeds the root cause's own scope plus what is genuinely CONTAINED
 *    in it.** A group spanning scattered usages must still target only where the fix belongs.
 */

function loc(startLine: number, endLine = startLine, file = 'src/a.ts'): Location {
  return { file, startLine, startCol: 1, endLine, endCol: 1 };
}

function finding(over: {
  id: string;
  ruleId: string;
  message: string;
  line: number;
  endLine?: number;
  severity?: Severity;
  repair?: RepairStrategy;
  enclosingRange?: { startLine: number; endLine: number };
  enclosingSymbol?: { startLine: number; endLine: number; name?: string };
}): Finding {
  return {
    id: over.id,
    source: 'tsc',
    ruleId: over.ruleId,
    severity: over.severity ?? 'error',
    category: 'correctness',
    location: loc(over.line, over.endLine ?? over.line),
    message: over.message,
    evidence: {
      snippet: '',
      relatedLocations: [],
      toolOutput: {},
      ...(over.enclosingRange ? { enclosingRange: over.enclosingRange } : {}),
      ...(over.enclosingSymbol
        ? {
            enclosingSymbol: {
              name: over.enclosingSymbol.name ?? 'fn',
              kind: 'function',
              location: loc(over.enclosingSymbol.startLine, over.enclosingSymbol.endLine),
            },
          }
        : {}),
    },
    fixable: false,
    repair: over.repair ?? 'ai-required',
    confidence: 1,
  };
}

describe('scopeRangeOf — the same precedence ai-service.ts uses for a repair target', () => {
  it('prefers enclosingRange when present', () => {
    const f = finding({
      id: 'a',
      ruleId: 'X',
      message: 'm',
      line: 10,
      enclosingRange: { startLine: 8, endLine: 12 },
      enclosingSymbol: { startLine: 1, endLine: 20 },
    });
    expect(scopeRangeOf(f)).toEqual({ startLine: 8, endLine: 12 });
  });

  it('falls back to enclosingSymbol when there is no enclosingRange', () => {
    const f = finding({
      id: 'a',
      ruleId: 'X',
      message: 'm',
      line: 10,
      enclosingSymbol: { startLine: 5, endLine: 15 },
    });
    expect(scopeRangeOf(f)).toEqual({ startLine: 5, endLine: 15 });
  });

  it('falls back to the finding’s own location as a last resort', () => {
    const f = finding({ id: 'a', ruleId: 'X', message: 'm', line: 10, endLine: 11 });
    expect(scopeRangeOf(f)).toEqual({ startLine: 10, endLine: 11 });
  });
});

describe('every finding lands in exactly one group', () => {
  it('accounts for every finding across mixed identifier and scope groups', () => {
    const findings = [
      finding({
        id: 'imp1',
        ruleId: 'TS2304',
        message: "Cannot find name 'fetchUser'.",
        line: 5,
      }),
      finding({
        id: 'imp2',
        ruleId: 'TS2304',
        message: "Cannot find name 'fetchUser'.",
        line: 40,
      }),
      finding({
        id: 'scope1',
        ruleId: 'no-unused-vars',
        message: 'x is unused',
        line: 100,
        enclosingSymbol: { startLine: 98, endLine: 105 },
      }),
      finding({
        id: 'lone',
        ruleId: 'prefer-const',
        message: 'use const',
        line: 200,
      }),
    ];
    const groups = groupByRootCause(findings);
    const allMembers = groups.flatMap((g) => [g.rootCause, ...g.mergeable, ...g.affected]);
    expect(allMembers).toHaveLength(findings.length);
    expect(new Set(allMembers.map((f) => f.id)).size).toBe(findings.length);
  });
});

describe('identifier groups — the missing-import case from the brief', () => {
  it('groups every TS2304 finding that names the same identifier, root cause first', () => {
    const findings = [
      finding({ id: 'f1', ruleId: 'TS2304', message: "Cannot find name 'config'.", line: 3 }),
      finding({ id: 'f2', ruleId: 'TS2304', message: "Cannot find name 'config'.", line: 40 }),
      finding({ id: 'f3', ruleId: 'TS2304', message: "Cannot find name 'config'.", line: 80 }),
      finding({ id: 'f4', ruleId: 'TS2304', message: "Cannot find name 'config'.", line: 120 }),
      finding({ id: 'f5', ruleId: 'TS2304', message: "Cannot find name 'config'.", line: 200 }),
    ];
    const groups = groupByRootCause(findings);
    expect(groups).toHaveLength(1);
    const group = groups[0]!;
    expect(group.basis).toBe('identifier');
    expect(group.rootCause.id).toBe('f1'); // earliest occurrence
    expect(group.affected).toHaveLength(4);
    expect(group.estimatedDiagnosticsRemoved).toBe(4);
  });

  it('does NOT widen the target range to reach scattered usages — the exact bug this design avoids', () => {
    const findings = [
      finding({ id: 'f1', ruleId: 'F821', message: "undefined name 'helper'", line: 2 }),
      finding({ id: 'f2', ruleId: 'F821', message: "undefined name 'helper'", line: 500 }),
    ];
    const [group] = groupByRootCause(findings);
    // The target is the root cause's OWN scope (its bare location here — no enclosingRange/Symbol
    // was given), not a range spanning line 2 to line 500.
    expect(group!.targetRange).toEqual({ startLine: 2, endLine: 2 });
    expect(group!.mergeable).toEqual([]); // f2 at line 500 is reported as context, never spliced
    expect(group!.affected.map((f) => f.id)).toEqual(['f2']);
  });

  it('different identifiers never merge, even on the same rule', () => {
    const findings = [
      finding({ id: 'f1', ruleId: 'TS2304', message: "Cannot find name 'a'.", line: 1 }),
      finding({ id: 'f2', ruleId: 'TS2304', message: "Cannot find name 'b'.", line: 2 }),
    ];
    const groups = groupByRootCause(findings);
    expect(groups).toHaveLength(2);
    expect(groups.every((g) => g.basis === 'singleton')).toBe(true);
  });

  it('a single occurrence of an identifier falls through to scope grouping, not a 1-member identifier group', () => {
    const findings = [
      finding({ id: 'f1', ruleId: 'TS2304', message: "Cannot find name 'x'.", line: 10 }),
    ];
    const [group] = groupByRootCause(findings);
    expect(group!.basis).toBe('singleton');
  });
});

describe('scope groups — transitive overlap', () => {
  it('merges three findings sharing one function, even when not every pair directly overlaps', () => {
    const findings = [
      // A and B share [10,20]; B and C share [15,30] via B's own range; A and C never directly
      // overlap — only the fixed-point expansion catches this.
      finding({ id: 'A', ruleId: 'r1', message: 'm', line: 10, enclosingRange: { startLine: 10, endLine: 20 } }),
      finding({ id: 'B', ruleId: 'r2', message: 'm', line: 15, enclosingRange: { startLine: 15, endLine: 30 } }),
      finding({ id: 'C', ruleId: 'r3', message: 'm', line: 28, enclosingRange: { startLine: 25, endLine: 35 } }),
    ];
    const groups = groupByRootCause(findings);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.basis).toBe('scope');
    const ids = [groups[0]!.rootCause, ...groups[0]!.mergeable].map((f) => f.id).sort();
    expect(ids).toEqual(['A', 'B', 'C']);
  });

  it('never merges findings in non-overlapping scopes', () => {
    const findings = [
      finding({ id: 'A', ruleId: 'r1', message: 'm', line: 1, enclosingRange: { startLine: 1, endLine: 5 } }),
      finding({ id: 'B', ruleId: 'r2', message: 'm', line: 50, enclosingRange: { startLine: 50, endLine: 55 } }),
    ];
    const groups = groupByRootCause(findings);
    expect(groups).toHaveLength(2);
  });

  it('a syntax/parse-class finding always wins root-cause priority over an unresolved name in the same scope', () => {
    const findings = [
      finding({
        id: 'undef',
        ruleId: 'F821',
        message: "undefined name 'x'",
        line: 12,
        enclosingRange: { startLine: 5, endLine: 20 },
      }),
      finding({
        id: 'syntax',
        ruleId: 'json-parse',
        message: 'Invalid JSON',
        line: 8,
        enclosingRange: { startLine: 5, endLine: 20 },
      }),
    ];
    const [group] = groupByRootCause(findings);
    expect(group!.rootCause.id).toBe('syntax');
  });

  it('falls back to severity, then to earliest line, when no priority rule applies', () => {
    const findings = [
      finding({
        id: 'warn',
        ruleId: 'style-a',
        message: 'm',
        line: 6,
        severity: 'warning',
        enclosingRange: { startLine: 1, endLine: 10 },
      }),
      finding({
        id: 'err',
        ruleId: 'style-b',
        message: 'm',
        line: 3,
        severity: 'error',
        enclosingRange: { startLine: 1, endLine: 10 },
      }),
    ];
    const [group] = groupByRootCause(findings);
    expect(group!.rootCause.id).toBe('err');
  });

  it('the target range unions only MERGEABLE members, staying minimal', () => {
    const findings = [
      finding({
        id: 'root',
        ruleId: 'json-parse',
        message: 'm',
        line: 10,
        enclosingRange: { startLine: 8, endLine: 12 },
      }),
      finding({
        id: 'inside',
        ruleId: 'r2',
        message: 'm',
        line: 9,
        enclosingRange: { startLine: 9, endLine: 9 }, // fully inside root's range
      }),
    ];
    const [group] = groupByRootCause(findings);
    expect(group!.targetRange).toEqual({ startLine: 8, endLine: 12 }); // unchanged — inside already contained
    expect(group!.mergeable.map((f) => f.id)).toEqual(['inside']);
  });
});

describe('manual findings are never absorbed into a coordinated patch', () => {
  it('excludes a manual-repair finding from `mergeable`, even when its scope is fully contained', () => {
    const findings = [
      finding({
        id: 'root',
        ruleId: 'json-parse',
        message: 'm',
        line: 10,
        enclosingRange: { startLine: 5, endLine: 20 },
      }),
      finding({
        id: 'manual-one',
        ruleId: 'weird-rule',
        message: 'm',
        line: 12,
        enclosingRange: { startLine: 12, endLine: 12 },
        repair: 'manual',
      }),
    ];
    const [group] = groupByRootCause(findings);
    expect(group!.mergeable.map((f) => f.id)).not.toContain('manual-one');
    expect(group!.affected.map((f) => f.id)).toContain('manual-one');
    // And the target range does not widen to include it either — it was never merged in.
    expect(group!.targetRange).toEqual({ startLine: 5, endLine: 20 });
  });
});

describe('estimatedDiagnosticsRemoved is honestly just the affected count', () => {
  it('is zero for a singleton group with nothing else nearby', () => {
    const [group] = groupByRootCause([
      finding({ id: 'solo', ruleId: 'prefer-const', message: 'm', line: 1 }),
    ]);
    expect(group!.estimatedDiagnosticsRemoved).toBe(0);
  });
});

describe('an empty file has nothing to group', () => {
  it('returns no groups for no findings', () => {
    expect(groupByRootCause([])).toEqual([]);
  });
});
