import { describe, expect, it } from 'vitest';

import { parseRepairOutput, parseTestOutput } from './schemas.js';

describe('schema-constrained output parsing', () => {
  it('accepts a well-formed repair output', () => {
    const raw = JSON.stringify({
      repairedCode: 'return `hi ${name}`;',
      rationale: 'Template literal is clearer.',
      confidence: 0.9,
    });
    const result = parseRepairOutput(raw);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.confidence).toBe(0.9);
  });

  it('rejects non-JSON with a typed reason (never best-effort)', () => {
    const result = parseRepairOutput('here is your fix: return `hi`;');
    expect(result).toEqual({ ok: false, reason: 'not-json' });
  });

  it('rejects JSON that is missing a required field', () => {
    const result = parseRepairOutput(JSON.stringify({ repairedCode: 'x', rationale: 'y' }));
    expect(result).toEqual({ ok: false, reason: 'schema-mismatch' });
  });

  it('rejects extra keys (strict) — a model cannot smuggle unexpected fields', () => {
    const result = parseRepairOutput(
      JSON.stringify({ repairedCode: 'x', rationale: 'y', confidence: 0.5, extra: 'nope' }),
    );
    expect(result).toEqual({ ok: false, reason: 'schema-mismatch' });
  });

  it('rejects confidence outside 0..1', () => {
    const result = parseRepairOutput(
      JSON.stringify({ repairedCode: 'x', rationale: 'y', confidence: 2 }),
    );
    expect(result).toEqual({ ok: false, reason: 'schema-mismatch' });
  });

  it('accepts a well-formed test output', () => {
    const raw = JSON.stringify({
      framework: 'vitest',
      testCode: "test('x', () => {})",
      rationale: 'covers the fix',
    });
    expect(parseTestOutput(raw).ok).toBe(true);
  });
});
