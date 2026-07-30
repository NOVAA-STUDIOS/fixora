import type { RepairMetric } from '@fixora/shared-types';
import { describe, expect, it } from 'vitest';

import {
  byLanguage,
  byMode,
  failureReasons,
  performanceStats,
  providerStats,
  sessionSummary,
  timeline,
  toCsv,
  toSummaryText,
  validationTotals,
} from './repair-analytics.js';

/**
 * Repair Analytics aggregation.
 *
 * Two things are worth testing hard. The arithmetic, because a diagnostics tool that reports the wrong
 * numbers is worse than none — it sends engineers after phantom problems. And the privacy guarantee,
 * because it is the constraint this whole feature was accepted under.
 */
function metric(over: Partial<RepairMetric> = {}): RepairMetric {
  return {
    at: 1_000,
    durationMs: 1000,
    language: 'typescript',
    mode: 'finding',
    provider: 'openrouter',
    model: 'test-model',
    ruleId: 'prefer-const',
    outcome: 'success',
    validation: { syntax: 'pass', lint: 'pass', type: 'pass', regression: 'pass' },
    sizes: {
      promptChars: 100,
      responseChars: 50,
      patchChars: 20,
      diffChars: 30,
      contextChars: 200,
    },
    ...over,
  };
}

describe('sessionSummary', () => {
  it('counts every outcome exactly once', () => {
    const s = sessionSummary([
      metric({ outcome: 'success' }),
      metric({ outcome: 'success' }),
      metric({ outcome: 'rejected' }),
      metric({ outcome: 'manual-only' }),
      metric({ outcome: 'timeout' }),
      metric({ outcome: 'cancelled' }),
      metric({ outcome: 'failed' }),
    ]);
    expect(s.attempted).toBe(7);
    expect(s.successful).toBe(2);
    expect(s.rejected).toBe(1);
    expect(s.manualOnly).toBe(1);
    expect(s.timedOut).toBe(1);
    expect(s.cancelled).toBe(1);
    expect(s.failed).toBe(1);
    // Every record lands in exactly one bucket — nothing double-counted, nothing dropped.
    expect(s.successful + s.rejected + s.manualOnly + s.timedOut + s.cancelled + s.failed).toBe(
      s.attempted,
    );
  });

  it('reports fastest, slowest and mean duration', () => {
    const s = sessionSummary([
      metric({ durationMs: 500 }),
      metric({ durationMs: 1500 }),
      metric({ durationMs: 1000 }),
    ]);
    expect(s.fastestMs).toBe(500);
    expect(s.slowestMs).toBe(1500);
    expect(s.averageMs).toBe(1000);
  });

  it('an empty dataset is zeros and nulls, never NaN', () => {
    const s = sessionSummary([]);
    expect(s.attempted).toBe(0);
    expect(s.successRate).toBe(0);
    expect(s.averageMs).toBe(0);
    expect(s.fastestMs).toBeNull();
    expect(s.slowestMs).toBeNull();
  });
});

describe('breakdowns', () => {
  it('groups by language with per-bucket rates, ordered by volume', () => {
    const groups = byLanguage([
      metric({ language: 'css', outcome: 'success' }),
      metric({ language: 'css', outcome: 'rejected' }),
      metric({ language: 'typescript', outcome: 'success' }),
      metric({ language: 'typescript', outcome: 'success' }),
      metric({ language: 'typescript', outcome: 'success' }),
    ]);
    expect(groups[0]?.name).toBe('typescript');
    expect(groups[0]?.bucket.successRate).toBe(100);
    const css = groups.find((g) => g.name === 'css');
    expect(css?.bucket.attempts).toBe(2);
    expect(css?.bucket.successRate).toBe(50);
    expect(css?.bucket.rejected).toBe(1);
  });

  it('groups by repair mode', () => {
    const groups = byMode([
      metric({ mode: 'ai-file' }),
      metric({ mode: 'finding' }),
      metric({ mode: 'finding' }),
    ]);
    expect(groups[0]?.name).toBe('finding');
    expect(groups[0]?.bucket.attempts).toBe(2);
  });
});

describe('validationTotals', () => {
  it('reports not-run separately — it must never be folded into a pass', () => {
    const totals = validationTotals([
      metric({
        validation: { syntax: 'pass', lint: 'not-run', type: 'not-run', regression: 'pass' },
      }),
      metric({ validation: { syntax: 'pass', lint: 'fail', type: 'not-run', regression: 'fail' } }),
    ]);
    expect(totals.syntax.pass).toBe(2);
    expect(totals.lint).toEqual({ pass: 0, fail: 1, 'not-run': 1 });
    // CSS/HTML/JSON ship no type checker; that must read as absence of evidence, not success.
    expect(totals.type['not-run']).toBe(2);
    expect(totals.type.pass).toBe(0);
  });
});

describe('failureReasons', () => {
  it('tallies reasons, most common first, ignoring successes', () => {
    const reasons = failureReasons([
      metric({ outcome: 'success' }),
      metric({ outcome: 'rejected', failureReason: 'regression' }),
      metric({ outcome: 'rejected', failureReason: 'regression' }),
      metric({ outcome: 'failed', failureReason: 'parser' }),
    ]);
    expect(reasons[0]).toEqual({ reason: 'regression', count: 2 });
    expect(reasons[1]).toEqual({ reason: 'parser', count: 1 });
    expect(reasons).toHaveLength(2);
  });
});

describe('providerStats', () => {
  it('separates provider/model pairs and counts timeouts', () => {
    const stats = providerStats([
      metric({ model: 'fast', outcome: 'success' }),
      metric({ model: 'fast', outcome: 'timeout' }),
      metric({ model: 'slow', outcome: 'success' }),
    ]);
    const fast = stats.find((s) => s.model === 'fast');
    expect(fast?.attempts).toBe(2);
    expect(fast?.timeouts).toBe(1);
    expect(fast?.successRate).toBe(50);
    expect(stats.find((s) => s.model === 'slow')?.successRate).toBe(100);
  });
});

describe('performanceStats', () => {
  it('averages every size dimension', () => {
    const p = performanceStats([
      metric({
        sizes: {
          promptChars: 100,
          responseChars: 10,
          patchChars: 2,
          diffChars: 4,
          contextChars: 200,
        },
      }),
      metric({
        sizes: {
          promptChars: 300,
          responseChars: 30,
          patchChars: 6,
          diffChars: 8,
          contextChars: 400,
        },
      }),
    ]);
    expect(p.averagePromptChars).toBe(200);
    expect(p.averageResponseChars).toBe(20);
    expect(p.averageContextChars).toBe(300);
  });
});

describe('timeline', () => {
  it('buckets across the data span and preserves the total count', () => {
    const records = Array.from({ length: 24 }, (_, i) =>
      metric({ at: 1000 + i * 100, outcome: i % 2 === 0 ? 'success' : 'rejected' }),
    );
    const points = timeline(records, 6);
    expect(points).toHaveLength(6);
    const total = points.reduce((n, p) => n + p.success + p.failures, 0);
    expect(total).toBe(24); // nothing lost or double-counted
  });

  it('is empty for no data rather than a row of zeros', () => {
    expect(timeline([])).toEqual([]);
  });
});

describe('export', () => {
  it('CSV has a header and one row per record', () => {
    const csv = toCsv([metric(), metric({ outcome: 'rejected', failureReason: 'verifier' })]);
    const lines = csv.split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('timestamp,language,mode');
    expect(lines[2]).toContain('verifier');
  });

  it('CSV escapes values that would otherwise break the format', () => {
    const csv = toCsv([metric({ ruleId: 'weird,"rule"' })]);
    expect(csv).toContain('"weird,""rule"""');
  });

  it('the summary text carries the headline numbers', () => {
    const text = toSummaryText([
      metric(),
      metric({ outcome: 'rejected', failureReason: 'parser' }),
    ]);
    expect(text).toContain('2 attempts');
    expect(text).toContain('typescript');
    expect(text).toContain('parser: 1');
  });
});

describe('privacy — the dataset cannot carry source code', () => {
  /**
   * Pinned as an exact column allow-list rather than a substring search. Searching for words like
   * "prompt" is useless here: `promptChars` is a SIZE and legitimately contains it. What actually
   * matters is that no NEW column can appear without this test failing, which is what makes a future
   * "just log the prompt too" change impossible to land quietly.
   */
  const ALLOWED_COLUMNS = [
    'timestamp',
    'language',
    'mode',
    'provider',
    'model',
    'ruleId',
    'outcome',
    'failureReason',
    'durationMs',
    'syntax',
    'lint',
    'type',
    'regression',
    'promptChars',
    'responseChars',
    'patchChars',
    'diffChars',
    'contextChars',
  ];

  it('the CSV emits exactly the approved columns and nothing else', () => {
    expect(toCsv([metric()]).split('\n')[0]?.split(',')).toEqual(ALLOWED_COLUMNS);
  });

  it('every size column is a NUMBER — a count of characters, never the characters', () => {
    const [, row = ''] = toCsv([metric()]).split('\n');
    const cells = row.split(',');
    for (const column of [
      'promptChars',
      'responseChars',
      'patchChars',
      'diffChars',
      'contextChars',
    ]) {
      const value = cells[ALLOWED_COLUMNS.indexOf(column)] ?? '';
      expect(Number.isFinite(Number(value)), `${column}=${value}`).toBe(true);
    }
  });

  it('a record carrying source-shaped content cannot reach the export at all', () => {
    // The schema is `.strict()`, so the store rejects this before it is ever stored. Here we prove the
    // export surface has no column that would carry it even if one arrived.
    const smuggled = { ...metric(), prompt: 'const secret = "hunter2";' } as RepairMetric;
    const csv = toCsv([smuggled]);
    expect(csv).not.toContain('hunter2');
    expect(toSummaryText([smuggled])).not.toContain('hunter2');
  });
});
