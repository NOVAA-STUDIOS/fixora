import { describe, expect, it } from 'vitest';

import type { NewFinding, VerificationReport } from './ai.js';
import { detectDependentFailure, isDependencyShapedRule } from './dependent-failure.js';

/**
 * The production case this exists for:
 *
 * ```ts
 * const response = fetch(url);          // line 10 — prerequisite, NOT in the patch range
 * const data = response.json();         // line 11 — the finding, and the whole patch range
 * ```
 *
 * The model returns `const data = await response.json();`, which is correct in isolation and still
 * does not compile. Line 11 alone is a range in which no correct patch exists, so the engine has to
 * notice that and widen rather than re-ask the same impossible question.
 */

const PATCH = { startLine: 11, endLine: 11 };

function report(over: Partial<VerificationReport> = {}): VerificationReport {
  return {
    verdict: 'regression',
    targetResolved: false,
    newFindingCount: 1,
    syntaxOk: true,
    ran: ['syntax', 'tsc'],
    ...over,
  };
}

const tsPropertyOnPromise: NewFinding = {
  source: 'tsc',
  ruleId: 'TS2339',
  line: 11,
  message: "Property 'json' does not exist on type 'Promise<Response>'.",
};

describe('detectDependentFailure — the missing-await case', () => {
  it('flags a type error at the patch site that is caused by a declaration elsewhere', () => {
    const found = detectDependentFailure(
      report({ newFindings: [tsPropertyOnPromise] }),
      PATCH,
    );
    expect(found).not.toBeNull();
    // The error is INSIDE the range, so there is no specific outside line to name — the caller
    // widens one level, which is what brings `const response = ...` into the splice.
    expect(found?.prerequisiteLines).toEqual([]);
    expect(found?.evidence).toEqual([tsPropertyOnPromise]);
    expect(found?.reason).toMatch(/declaration outside the code it replaces/i);
  });

  it('flags an error the patch introduced OUTSIDE the range, and names the line to include', () => {
    const found = detectDependentFailure(
      report({
        newFindings: [
          {
            source: 'eslint',
            ruleId: '@typescript-eslint/no-floating-promises',
            line: 10,
            message: 'Promises must be awaited.',
          },
        ],
      }),
      PATCH,
    );
    expect(found?.prerequisiteLines).toEqual([10]);
    expect(found?.reason).toMatch(/outside the code it replaces/i);
    expect(found?.reason).toContain('11-11');
  });

  it('prefers the outside evidence when both kinds are present', () => {
    const outside: NewFinding = {
      source: 'tsc',
      ruleId: 'TS2304',
      line: 4,
      message: "Cannot find name 'response'.",
    };
    const found = detectDependentFailure(
      report({ newFindings: [tsPropertyOnPromise, outside] }),
      PATCH,
    );
    // Outside evidence is actionable — it points at a line. Inside evidence only says "go up".
    expect(found?.evidence).toEqual([outside]);
    expect(found?.prerequisiteLines).toEqual([4]);
  });

  it('deduplicates and sorts prerequisite lines', () => {
    const at = (line: number): NewFinding => ({
      source: 'tsc',
      ruleId: 'TS2304',
      line,
      message: 'Cannot find name.',
    });
    const found = detectDependentFailure(
      report({ newFindings: [at(30), at(4), at(30)] }),
      PATCH,
    );
    expect(found?.prerequisiteLines).toEqual([4, 30]);
  });
});

describe('detectDependentFailure — what must NEVER widen', () => {
  it('a verified patch', () => {
    expect(
      detectDependentFailure(
        report({ verdict: 'verified', newFindings: [tsPropertyOnPromise] }),
        PATCH,
      ),
    ).toBeNull();
  });

  it('a skipped verdict — nothing ran, so nothing can be attributed', () => {
    expect(
      detectDependentFailure(
        report({ verdict: 'skipped', newFindings: [tsPropertyOnPromise] }),
        PATCH,
      ),
    ).toBeNull();
  });

  it('a patch that does not parse — malformed, not incomplete (balanced-scope owns that)', () => {
    expect(
      detectDependentFailure(
        report({ syntaxOk: false, newFindings: [tsPropertyOnPromise] }),
        PATCH,
      ),
    ).toBeNull();
  });

  it('a failure with no verifier evidence — widening on a hunch is not allowed', () => {
    expect(detectDependentFailure(report({ newFindings: [] }), PATCH)).toBeNull();
    expect(detectDependentFailure(report(), PATCH)).toBeNull();
  });

  it('an in-range error that is fully fixable where it stands', () => {
    // A style violation at the patch site says the model was wrong, not that the range is too small.
    // Widening here would spend a larger blast radius on a bad answer.
    const found = detectDependentFailure(
      report({
        newFindings: [
          { source: 'eslint', ruleId: 'semi', line: 11, message: 'Missing semicolon.' },
        ],
      }),
      PATCH,
    );
    expect(found).toBeNull();
  });

  it('an unused-variable error at the patch site', () => {
    const found = detectDependentFailure(
      report({
        newFindings: [
          {
            source: 'eslint',
            ruleId: '@typescript-eslint/no-unused-vars',
            line: 11,
            message: "'data' is assigned a value but never used.",
          },
        ],
      }),
      PATCH,
    );
    expect(found).toBeNull();
  });
});

describe('isDependencyShapedRule', () => {
  it('accepts the declaration-caused TypeScript codes, in either case', () => {
    for (const id of ['TS2339', 'ts2304', 'TS18047', 'TS2345']) {
      expect(isDependencyShapedRule(id)).toBe(true);
    }
  });

  it('accepts a TS code carried in the message rather than the rule id', () => {
    expect(isDependencyShapedRule('typescript', 'TS2339: Property does not exist')).toBe(true);
  });

  it('rejects rules whose fix is always local', () => {
    for (const id of ['semi', 'quotes', 'no-console', 'prefer-const', 'max-len']) {
      expect(isDependencyShapedRule(id)).toBe(false);
    }
  });

  it('does not match an arbitrary number that happens to follow "ts"', () => {
    expect(isDependencyShapedRule('custom', 'artefacts 123 found')).toBe(false);
    // A real TS code that is NOT declaration-shaped stays out.
    expect(isDependencyShapedRule('TS1005', 'expected')).toBe(false);
  });
});
