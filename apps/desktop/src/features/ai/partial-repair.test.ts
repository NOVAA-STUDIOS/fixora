import { describe, expect, it } from 'vitest';

import { partialRepairedCode } from './partial-repair.js';

/**
 * Reading repaired code out of a half-arrived JSON response.
 *
 * The property that matters is that it never invents anything: at every prefix of a response it
 * returns a prefix of the real value, or nothing. A preview that guessed ahead and then corrected
 * itself would flicker, and worse, would briefly show the user code the model never sent.
 */
const FULL = '{"repairedCode":"const a = 1;\\nreturn a;","rationale":"r","confidence":0.9}';

describe('partialRepairedCode', () => {
  it('returns nothing until the key has arrived', () => {
    expect(partialRepairedCode('')).toBe('');
    expect(partialRepairedCode('{"repai')).toBe('');
    expect(partialRepairedCode('{"repairedCode"')).toBe('');
    expect(partialRepairedCode('{"repairedCode":')).toBe('');
  });

  it('reads the value as it streams in', () => {
    expect(partialRepairedCode('{"repairedCode":"const ')).toBe('const ');
    expect(partialRepairedCode('{"repairedCode":"const a = 1;')).toBe('const a = 1;');
  });

  it('decodes escapes rather than showing them raw', () => {
    expect(partialRepairedCode('{"repairedCode":"a\\nb"')).toBe('a\nb');
    expect(partialRepairedCode('{"repairedCode":"say \\"hi\\""')).toBe('say "hi"');
    expect(partialRepairedCode('{"repairedCode":"back\\\\slash"')).toBe('back\\slash');
    expect(partialRepairedCode('{"repairedCode":"tab\\there"')).toBe('tab\there');
    expect(partialRepairedCode('{"repairedCode":"\\u0041B"')).toBe('AB');
  });

  it('waits rather than guessing at a half-arrived escape', () => {
    // The next chunk turns this into a newline; showing a stray backslash first would flicker.
    expect(partialRepairedCode('{"repairedCode":"a\\')).toBe('a');
    expect(partialRepairedCode('{"repairedCode":"a\\u00')).toBe('a');
  });

  it('stops at the closing quote and ignores the rest of the object', () => {
    expect(partialRepairedCode(FULL)).toBe('const a = 1;\nreturn a;');
  });

  it('every prefix of a real response yields a prefix of the real value', () => {
    // The anti-flicker property, asserted exhaustively rather than at sampled points.
    const complete = partialRepairedCode(FULL);
    for (let i = 0; i <= FULL.length; i += 1) {
      const partial = partialRepairedCode(FULL.slice(0, i));
      expect(complete.startsWith(partial), `prefix ${String(i)} produced ${JSON.stringify(partial)}`).toBe(
        true,
      );
    }
  });

  it('never grows shorter as more of the response arrives', () => {
    let previous = 0;
    for (let i = 0; i <= FULL.length; i += 1) {
      const length = partialRepairedCode(FULL.slice(0, i)).length;
      expect(length).toBeGreaterThanOrEqual(previous);
      previous = length;
    }
  });

  it('tolerates whitespace between the key and its value', () => {
    expect(partialRepairedCode('{ "repairedCode" :  "x"')).toBe('x');
  });

  it('returns nothing for prose that is not the structured response', () => {
    expect(partialRepairedCode('I will now fix the function.')).toBe('');
  });
});
