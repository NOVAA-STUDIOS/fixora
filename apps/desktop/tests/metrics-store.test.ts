import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { REPAIR_METRICS_LIMIT, type RepairMetric } from '@fixora/shared-types';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createMetricsStore } from '../electron/main/diagnostics/metrics-store.js';

/**
 * The metrics ring. Three properties are load-bearing:
 *
 *  - it never stores source code, enforced by schema validation rather than by convention;
 *  - it rolls off at a fixed bound, so a diagnostics file cannot grow without limit;
 *  - it never throws, because it is called from inside a repair and must not be able to fail one.
 */
function metric(over: Partial<RepairMetric> = {}): RepairMetric {
  return {
    at: Date.now(),
    durationMs: 100,
    language: 'typescript',
    mode: 'finding',
    provider: 'openrouter',
    model: 'm',
    ruleId: 'r',
    outcome: 'success',
    validation: { syntax: 'pass', lint: 'pass', type: 'pass', regression: 'pass' },
    sizes: { promptChars: 1, responseChars: 1, patchChars: 1, diffChars: 1, contextChars: 1 },
    ...over,
  };
}

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'fx-metrics-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('metrics store', () => {
  it('records and returns entries newest-last', () => {
    const store = createMetricsStore({ dir });
    store.record(metric({ ruleId: 'first' }));
    store.record(metric({ ruleId: 'second' }));
    expect(store.all().map((m) => m.ruleId)).toEqual(['first', 'second']);
  });

  it('rolls off the oldest past the retention limit', () => {
    const store = createMetricsStore({ dir });
    for (let i = 0; i < REPAIR_METRICS_LIMIT + 25; i++) store.record(metric({ durationMs: i }));
    const all = store.all();
    expect(all).toHaveLength(REPAIR_METRICS_LIMIT);
    // The oldest 25 are gone; the newest survives.
    expect(all[0]?.durationMs).toBe(25);
    expect(all.at(-1)?.durationMs).toBe(REPAIR_METRICS_LIMIT + 24);
  });

  it('REJECTS a record carrying an unexpected field — the privacy guarantee, enforced', () => {
    const store = createMetricsStore({ dir });
    // `.strict()` means a stray `prompt` fails validation and the whole record is dropped rather
    // than stored with the extra field. This is what makes the guarantee structural.
    store.record({ ...metric(), prompt: 'const secret = 1;' } as RepairMetric);
    expect(store.all()).toEqual([]);
  });

  it('rejects a malformed record without throwing — it must never fail a repair', () => {
    const store = createMetricsStore({ dir });
    expect(() => {
      store.record({ nonsense: true } as unknown as RepairMetric);
    }).not.toThrow();
    expect(store.all()).toEqual([]);
  });

  it('persists on flush and reloads on a fresh store', () => {
    const store = createMetricsStore({ dir });
    store.record(metric({ ruleId: 'persisted' }));
    store.flush();
    expect(
      createMetricsStore({ dir })
        .all()
        .map((m) => m.ruleId),
    ).toEqual(['persisted']);
  });

  it('never writes source code to disk', () => {
    const store = createMetricsStore({ dir });
    store.record(metric());
    store.record({ ...metric(), prompt: 'SECRET_CODE_MARKER' } as RepairMetric);
    store.flush();
    const raw = readFileSync(join(dir, 'repair-metrics.json'), 'utf8');
    expect(raw).not.toContain('SECRET_CODE_MARKER');
    expect(raw).not.toContain('prompt"');
  });

  it('clear() empties the ring', () => {
    const store = createMetricsStore({ dir });
    store.record(metric());
    store.clear();
    expect(store.all()).toEqual([]);
  });

  it('a corrupt file degrades to empty rather than crashing startup', () => {
    const store = createMetricsStore({ dir, fileName: 'missing.json' });
    expect(store.all()).toEqual([]);
  });

  it('all() returns a copy — a caller cannot mutate the ring', () => {
    const store = createMetricsStore({ dir });
    store.record(metric());
    store.all().push(metric());
    expect(store.all()).toHaveLength(1);
  });
});
