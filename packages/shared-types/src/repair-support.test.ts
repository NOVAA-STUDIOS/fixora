import { describe, expect, it } from 'vitest';

import type { Finding } from './analysis.js';
import {
  isRepairAttemptable,
  isRepairSupportedPath,
  REPAIR_STATE_LABEL,
  REPAIR_STATE_REASON,
  repairStateFor,
  type RepairState,
} from './repair-support.js';

/**
 * ISSUE 2/5 regression: every finding must expose exactly one of four repair states.
 *
 * Before this there were three, and the missing fourth was the one the UI most needed: `Finding.repair`
 * is the ANALYZER's judgement about the RULE, and says nothing about whether the repair pipeline can
 * act on the FILE. Collapsing "no fix for this rule" and "no support for this file type" into one
 * disabled button left the UI unable to explain which it was.
 */

function finding(over: Partial<Finding> = {}): Finding {
  return {
    id: 'f1',
    source: 'eslint',
    ruleId: 'no-unused-vars',
    severity: 'error',
    category: 'correctness',
    location: { file: 'src/a.ts', startLine: 1, startCol: 1, endLine: 1, endCol: 1 },
    message: 'x',
    evidence: { snippet: '', relatedLocations: [], toolOutput: null },
    fixable: false,
    repair: 'ai-required',
    confidence: 1,
    ...over,
  };
}

describe('repairStateFor', () => {
  it('maps the analyzer classifications to the three actionable states', () => {
    expect(repairStateFor(finding({ repair: 'safe-auto' }))).toBe('repairable');
    expect(repairStateFor(finding({ repair: 'ai-required' }))).toBe('ai-repairable');
    expect(repairStateFor(finding({ repair: 'manual' }))).toBe('manual-only');
  });

  it('reports an unsupported file type as its own state, whatever the rule says', () => {
    const at = (file: string) => ({
      location: { file, startLine: 1, startCol: 1, endLine: 1, endCol: 1 },
    });
    expect(repairStateFor(finding({ ...at('notes.md'), repair: 'safe-auto' }))).toBe('unsupported');
    expect(repairStateFor(finding({ ...at('script.rb'), repair: 'ai-required' }))).toBe(
      'unsupported',
    );
    // Language support is checked FIRST — an unsupported file cannot be repaired however the
    // analyzer classified the rule, so reporting the rule's verdict would describe a decision that
    // never gets made.
    expect(repairStateFor(finding({ ...at('config.yaml'), repair: 'manual' }))).toBe('unsupported');
  });

  it('classifies a config/environment tsc diagnostic as config-issue, even when ai-required', () => {
    expect(
      repairStateFor(
        finding({
          source: 'tsc',
          ruleId: 'TS2591',
          message: "Cannot find name 'crypto'. Do you need to install type definitions for node?",
          repair: 'ai-required',
        }),
      ),
    ).toBe('config-issue');
  });

  it('leaves a genuine tsc source defect classified normally', () => {
    expect(
      repairStateFor(
        finding({
          source: 'tsc',
          ruleId: 'TS2345',
          message: "Argument of type 'string' is not assignable to parameter of type 'number'.",
          repair: 'ai-required',
        }),
      ),
    ).toBe('ai-repairable');
  });

  it('never classifies a non-tsc finding as config-issue, even with a matching ruleId string', () => {
    expect(
      repairStateFor(finding({ source: 'eslint', ruleId: 'TS2591', repair: 'ai-required' })),
    ).toBe('ai-repairable');
  });

  it('treats every language the repair pipeline supports as supported', () => {
    for (const file of [
      'a.ts',
      'a.tsx',
      'a.mts',
      'a.cts',
      'a.js',
      'a.jsx',
      'a.mjs',
      'a.cjs',
      'a.py',
      'a.pyi',
      'a.go',
      'package.json',
      'styles.css',
      'index.html',
      'index.htm',
    ]) {
      expect(isRepairSupportedPath(file), file).toBe(true);
    }
  });

  it('is case-insensitive on the extension', () => {
    expect(isRepairSupportedPath('A.TS')).toBe(true);
    expect(isRepairSupportedPath('STYLES.CSS')).toBe(true);
  });
});

describe('isRepairAttemptable', () => {
  it('only the two states with a fix are attemptable', () => {
    expect(isRepairAttemptable('repairable')).toBe(true);
    expect(isRepairAttemptable('ai-repairable')).toBe(true);
    expect(isRepairAttemptable('manual-only')).toBe(false);
    expect(isRepairAttemptable('unsupported')).toBe(false);
    // The whole point of the classifier: a config issue must never be attemptable, so it can never
    // reach AI Repair through the button that gates every other attempt.
    expect(isRepairAttemptable('config-issue')).toBe(false);
  });
});

describe('state copy', () => {
  const states: RepairState[] = [
    'repairable',
    'ai-repairable',
    'manual-only',
    'unsupported',
    'config-issue',
  ];

  it('every state has a label and a specific, non-generic reason', () => {
    for (const state of states) {
      expect(REPAIR_STATE_LABEL[state].length).toBeGreaterThan(0);
      const reason = REPAIR_STATE_REASON[state];
      expect(reason.length).toBeGreaterThan(20);
      expect(reason.toLowerCase()).not.toContain('something went wrong');
      expect(reason.toLowerCase()).not.toContain('internal error');
    }
  });

  it('the two refusing states give DIFFERENT reasons — that distinction is the whole point', () => {
    expect(REPAIR_STATE_REASON['manual-only']).not.toBe(REPAIR_STATE_REASON.unsupported);
    expect(REPAIR_STATE_REASON['manual-only']).toMatch(/judgment|judgement/i);
    expect(REPAIR_STATE_REASON.unsupported).toMatch(/file type/i);
  });
});
