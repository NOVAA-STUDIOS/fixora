import type { AiProposal } from '@fixora/shared-types';
import { describe, expect, it } from 'vitest';

import { validationBadges, type ValidationBadge } from './validation-badges.js';

/**
 * ISSUE 7 regression: a repair must never claim a validator passed when that validator does not
 * exist for the language, or when we cannot prove it ran.
 *
 * Three of the seven supported languages (JSON, CSS, HTML) have no linter and no type checker in this
 * stack. A "✓ Lint ✓ Type" row on a CSS repair would be a claim about checks that never happened —
 * the same class of overclaim beta audit A5 removed from the "Verified" wording.
 */

type Repair = Extract<AiProposal, { profile: 'repair' }>;
type Report = Repair['verification'];

function proposal(file: string, report: Partial<Report> = {}): Repair {
  return {
    profile: 'repair',
    historyId: 'h1',
    repairedCode: 'x',
    originalCode: 'y',
    rationale: 'because',
    confidence: 0.9,
    target: { file, startLine: 1, endLine: 2, symbolName: null },
    verification: {
      verdict: 'verified',
      targetResolved: true,
      newFindingCount: 0,
      syntaxOk: true,
      ran: ['syntax'],
      ...report,
    },
  };
}

function byName(badges: ValidationBadge[], name: ValidationBadge['name']): ValidationBadge {
  const found = badges.find((b) => b.name === name);
  if (found === undefined) throw new Error(`no ${name} badge`);
  return found;
}

describe('validationBadges — honesty for languages without a validator', () => {
  for (const file of ['styles.css', 'index.html', 'package.json']) {
    it(`${file}: Lint and Type are "not run", never a green check`, () => {
      const badges = validationBadges(proposal(file));
      expect(byName(badges, 'Lint').status).toBe('not-run');
      expect(byName(badges, 'Type').status).toBe('not-run');
      expect(byName(badges, 'Lint').detail).toMatch(/no linter ships/i);
      expect(byName(badges, 'Type').detail).toMatch(/no type checker ships/i);
    });
  }

  it('a Python file has a linter and a type checker, so neither is dismissed as unavailable', () => {
    const badges = validationBadges(proposal('main.py', { ran: ['syntax', 'ruff', 'mypy'] }));
    expect(byName(badges, 'Lint').status).toBe('pass');
    expect(byName(badges, 'Type').status).toBe('pass');
  });

  it('a TypeScript file with no tool results reports not-run, NOT pass', () => {
    // `ran` only lists sources that produced a finding, so "linted cleanly" and "never linted" are
    // indistinguishable. Claiming a pass here would be inventing a check.
    const badges = validationBadges(proposal('a.ts', { ran: ['syntax'] }));
    expect(byName(badges, 'Lint').status).toBe('not-run');
    expect(byName(badges, 'Type').status).toBe('not-run');
  });
});

describe('validationBadges — failures are reported as failures', () => {
  it('a patch that does not parse fails Syntax and does not claim a regression check', () => {
    const badges = validationBadges(proposal('a.ts', { syntaxOk: false, verdict: 'regression' }));
    expect(byName(badges, 'Syntax').status).toBe('fail');
    // Analyzers cannot have run meaningfully on a file that does not parse, so "no new problems"
    // would be an artifact of nothing having been checked.
    expect(byName(badges, 'Regression').status).toBe('not-run');
  });

  it('new lint findings fail the Lint badge and name the count', () => {
    const badges = validationBadges(
      proposal('a.ts', {
        ran: ['syntax', 'eslint'],
        newFindingCount: 2,
        newFindings: [
          { source: 'eslint', ruleId: 'no-undef', line: 3, message: 'x' },
          { source: 'eslint', ruleId: 'no-undef', line: 4, message: 'y' },
        ],
      }),
    );
    expect(byName(badges, 'Lint').status).toBe('fail');
    expect(byName(badges, 'Lint').detail).toContain('2');
  });

  it('new type errors fail the Type badge specifically, not the Lint one', () => {
    const badges = validationBadges(
      proposal('a.ts', {
        ran: ['syntax', 'tsc'],
        newFindingCount: 1,
        newFindings: [{ source: 'tsc', ruleId: 'TS2322', line: 3, message: 'x' }],
      }),
    );
    expect(byName(badges, 'Type').status).toBe('fail');
    expect(byName(badges, 'Lint').status).toBe('not-run');
  });

  it('any new finding fails Regression, even in a language with no linter', () => {
    const badges = validationBadges(
      proposal('styles.css', {
        newFindingCount: 1,
        newFindings: [{ source: 'css', ruleId: 'css-syntax', line: 2, message: 'x' }],
      }),
    );
    expect(byName(badges, 'Regression').status).toBe('fail');
    // Still honest about the checks that genuinely do not exist for CSS.
    expect(byName(badges, 'Lint').status).toBe('not-run');
  });

  it('a clean CSS repair still gets a real Regression pass — that check IS meaningful', () => {
    const badges = validationBadges(proposal('styles.css'));
    expect(byName(badges, 'Regression').status).toBe('pass');
    expect(byName(badges, 'Syntax').status).toBe('pass');
  });

  it('always returns exactly the four badges, in a stable order', () => {
    expect(validationBadges(proposal('a.ts')).map((b) => b.name)).toEqual([
      'Syntax',
      'Lint',
      'Type',
      'Regression',
    ]);
  });

  it('no badge detail is ever an empty or generic placeholder', () => {
    for (const file of ['a.ts', 'main.py', 'styles.css', 'index.html', 'x.json']) {
      for (const badge of validationBadges(proposal(file))) {
        expect(badge.detail.length).toBeGreaterThan(10);
        expect(badge.detail.toLowerCase()).not.toContain('something went wrong');
      }
    }
  });
});
