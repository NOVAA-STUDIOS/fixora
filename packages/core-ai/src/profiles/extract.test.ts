import { describe, expect, it } from 'vitest';

import { extractJson } from './extract.js';
import { parseRepairOutput } from './schemas.js';

/**
 * Regression tests for the release-blocking "The model returned an invalid response." bug.
 *
 * Every case below is a shape a real model actually returns. Before this change the parser was
 * `JSON.parse(raw)` and every one of them failed — with the same unhelpful sentence, so the four
 * distinct causes were indistinguishable from the outside.
 *
 * Two properties are asserted throughout, and they are the point:
 *   1. Recoverable wrappers are recovered.
 *   2. Recovery is never silent — `recovery` names every step that fired.
 */

const VALID = { repairedCode: 'const a = 1;', rationale: 'because', confidence: 0.9 };

describe('extractJson — recovers wrappers without altering content', () => {
  it('parses clean JSON with no recovery', () => {
    const r = extractJson(JSON.stringify(VALID));
    expect(r.ok && r.recovery).toEqual(['none']);
  });

  it('recovers from a ```json markdown fence — the most common real failure', () => {
    const raw = '```json\n' + JSON.stringify(VALID) + '\n```';
    const r = extractJson(raw);
    expect(r.ok).toBe(true);
    expect(r.ok && r.json).toEqual(VALID);
    expect(r.ok && r.recovery).toContain('code-fence');
  });

  it('recovers from a bare ``` fence with no language tag', () => {
    const r = extractJson('```\n' + JSON.stringify(VALID) + '\n```');
    expect(r.ok && r.json).toEqual(VALID);
  });

  it('recovers an object buried in prose', () => {
    const r = extractJson(`Sure! Here is the fix:\n${JSON.stringify(VALID)}\nHope that helps.`);
    expect(r.ok).toBe(true);
    expect(r.ok && r.recovery).toContain('balanced-object');
  });

  it('does NOT truncate at a brace inside a string literal', () => {
    // The reason this needs a scanner and not a regex: repairedCode is source code, and source
    // code is full of braces. A regex ends the object at the first `}` and silently corrupts it.
    const withBraces = { ...VALID, repairedCode: 'function f() { return {a: 1}; }' };
    const r = extractJson('```json\n' + JSON.stringify(withBraces) + '\n```');
    expect(r.ok).toBe(true);
    expect(r.ok && r.json).toEqual(withBraces);
  });

  it('recovers from a trailing comma', () => {
    const r = extractJson('{"repairedCode":"x","rationale":"y","confidence":0.5,}');
    expect(r.ok).toBe(true);
    expect(r.ok && r.recovery).toContain('trailing-comma');
  });

  it('reports truncation as truncation, not as malformed', () => {
    const r = extractJson('{"repairedCode":"const a = 1;","rationale":"beca');
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toBe('truncated');
    expect(!r.ok && r.detail).toContain('token limit');
  });

  it('reports a prose-only answer distinctly', () => {
    const r = extractJson('I cannot help with that request.');
    expect(!r.ok && r.reason).toBe('no-json-object');
  });

  it('reports an empty response distinctly', () => {
    expect(extractJson('   ').ok).toBe(false);
    const r = extractJson('   ');
    expect(!r.ok && r.reason).toBe('empty');
  });
});

describe('parseRepairOutput — the exact bug, end to end', () => {
  it('succeeds on fenced output that previously failed every time', () => {
    const r = parseRepairOutput('```json\n' + JSON.stringify(VALID) + '\n```');
    expect(r.ok).toBe(true);
    expect(r.ok && r.value.repairedCode).toBe('const a = 1;');
    expect(r.ok && r.recovery).toContain('code-fence');
  });

  it('names the missing field instead of saying "invalid response"', () => {
    const r = parseRepairOutput(JSON.stringify({ rationale: 'x', confidence: 0.5 }));
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toBe('schema-mismatch');
    // The whole point: the message identifies the field.
    expect(!r.ok && r.detail).toContain('repairedCode');
    expect(!r.ok && r.issues?.join(' ')).toContain('repairedCode');
  });

  it('distinguishes all four failure causes that used to share one message', () => {
    const reasons = [
      parseRepairOutput(''),
      parseRepairOutput('I refuse.'),
      parseRepairOutput('{"repairedCode":"a'),
      parseRepairOutput('{"confidence":"not-a-number"}'),
    ].map((r) => (r.ok ? 'ok' : r.reason));
    expect(reasons).toEqual(['empty', 'no-json-object', 'truncated', 'schema-mismatch']);
  });

  it('always returns the text it tried to parse, for the debug file', () => {
    const r = parseRepairOutput('```json\n{"broken":');
    expect(r.ok).toBe(false);
    expect(!r.ok && typeof r.text).toBe('string');
  });
});
