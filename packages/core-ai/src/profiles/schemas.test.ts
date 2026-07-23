import { describe, expect, it } from 'vitest';

import { parseEditOutput, parseRepairOutput, parseTestOutput } from './schemas.js';

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
    // The reason is specific now — a prose answer is distinguishable from a truncated one — but the
    // guarantee this test protects is unchanged: no content is invented to fill a gap.
    const result = parseRepairOutput('here is your fix: return `hi`;');
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toBe('no-json-object');
  });

  it('rejects JSON that is missing a required field', () => {
    const result = parseRepairOutput(JSON.stringify({ repairedCode: 'x', rationale: 'y' }));
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toBe('schema-mismatch');
    // Names the field, so the UI never has to say "invalid response".
    expect(!result.ok && result.detail).toContain('confidence');
  });

  it('rejects extra keys (strict) — a model cannot smuggle unexpected fields', () => {
    const result = parseRepairOutput(
      JSON.stringify({ repairedCode: 'x', rationale: 'y', confidence: 0.5, extra: 'nope' }),
    );
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toBe('schema-mismatch');
  });

  it('rejects confidence outside 0..1', () => {
    const result = parseRepairOutput(
      JSON.stringify({ repairedCode: 'x', rationale: 'y', confidence: 2 }),
    );
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toBe('schema-mismatch');
  });

  it('accepts a well-formed test output', () => {
    const raw = JSON.stringify({
      framework: 'vitest',
      testCode: "test('x', () => {})",
      rationale: 'covers the fix',
    });
    expect(parseTestOutput(raw).ok).toBe(true);
  });

  it('accepts a well-formed edit output (Proceed Mode)', () => {
    const raw = JSON.stringify({
      editedCode: 'export const Button = () => <button className="green">x</button>;',
      summary: 'Added the green class to the button.',
      confidence: 0.85,
    });
    expect(parseEditOutput(raw).ok).toBe(true);
  });

  it('rejects an edit output missing editedCode', () => {
    const result = parseEditOutput(JSON.stringify({ summary: 'x', confidence: 0.5 }));
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toBe('schema-mismatch');
  });

  it('rejects an empty editedCode (a no-op edit is not an edit)', () => {
    const result = parseEditOutput(
      JSON.stringify({ editedCode: '', summary: 'x', confidence: 0.5 }),
    );
    expect(result.ok).toBe(false);
  });
});
