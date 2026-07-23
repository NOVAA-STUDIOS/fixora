import { describe, expect, it } from 'vitest';

import { classifyIntent } from './intent.js';

/**
 * Intent detection is deterministic, so it is tested like the pure function it is: the same
 * instruction always yields the same category, the sprint's canonical examples land where a developer
 * expects, and anything unrecognised is `unknown` (which the pipeline refuses rather than guessing).
 */

describe('classifyIntent', () => {
  it('classifies the sprint canonical examples', () => {
    expect(classifyIntent('Make this button green.').intent).toBe('styling');
    expect(classifyIntent('Rename this variable.').intent).toBe('refactoring');
    expect(classifyIntent('Add loading state.').intent).toBe('react');
    expect(classifyIntent('Make this responsive.').intent).toBe('styling');
    expect(classifyIntent('Convert this file to TypeScript.').intent).toBe('typescript');
  });

  it('detects documentation and explanation intents', () => {
    expect(classifyIntent('Add a docstring to this function').intent).toBe('documentation');
    expect(classifyIntent('Explain what this does').intent).toBe('explanation');
  });

  it('returns unknown for an instruction that matches no category', () => {
    const r = classifyIntent('asdf qwerty zxcv');
    expect(r.intent).toBe('unknown');
    expect(r.confidence).toBe(0);
    expect(r.matched).toEqual([]);
  });

  it('fails gracefully on empty / whitespace input', () => {
    expect(classifyIntent('').intent).toBe('unknown');
    expect(classifyIntent('   ').intent).toBe('unknown');
  });

  it('is deterministic — identical input, identical output', () => {
    const a = classifyIntent('make the background blue and rounded');
    const b = classifyIntent('make the background blue and rounded');
    expect(a).toEqual(b);
    expect(a.intent).toBe('styling');
  });

  it('reports confidence in [0, 0.9] and the concrete matched tokens', () => {
    const r = classifyIntent('rename this variable and extract a function');
    expect(r.intent).toBe('refactoring');
    expect(r.confidence).toBeGreaterThan(0);
    expect(r.confidence).toBeLessThanOrEqual(0.9);
    expect(r.matched.length).toBeGreaterThan(0);
  });

  /**
   * P2.2 runtime defects, found by the live editing acceptance run and fixed here.
   */
  it('P2.2 defect A: a .py file is never a TypeScript edit — language disambiguates', () => {
    const instruction =
      'add a type hint annotation for the text parameter of word_count (it is a str)';
    // Without the hint, "type"/"type annotation" (TypeScript) outscored "type hint" (Python).
    expect(classifyIntent(instruction).intent).toBe('typescript');
    // With the real file language, the contradictory category is dropped.
    expect(classifyIntent(instruction, { language: 'python' }).intent).toBe('python');
  });

  it('P2.2 defect A: a .ts file is never a Python edit', () => {
    expect(classifyIntent('add a type hint', { language: 'typescript' }).intent).not.toBe('python');
  });

  it('P2.2 defect B: a structural field/property edit is classified, not dropped as unknown', () => {
    expect(
      classifyIntent('add a top-level field "maxConnections" set to the number 10').intent,
    ).toBe('refactoring');
    expect(classifyIntent('add a property timeout to the config').intent).toBe('refactoring');
    // ...without stealing React's more specific signal.
    expect(classifyIntent('add loading state').intent).toBe('react');
  });

  /**
   * P2.2.1: the classifier was a closed allowlist whose default was REJECT, so 8 of 17 ordinary
   * instructions ("add error handling", "center this element") were refused as unknown. A finite
   * lexicon can never cover English; the fix is the failure posture, not more keywords.
   */
  it('P2.2.1: never rejects a valid instruction — an unmatched action falls back to `general`', () => {
    for (const instruction of [
      'add error handling',
      'wrap this in try/catch',
      'add a null check',
      'make this async',
      'convert to arrow function',
      'sort these keys',
      'make it bigger',
    ]) {
      expect(classifyIntent(instruction).intent, instruction).not.toBe('unknown');
    }
  });

  it('P2.2.1: still refuses input with no recognisable action', () => {
    for (const junk of ['asdf qwerty zxcv', '', '   ', 'zzzz']) {
      expect(classifyIntent(junk).intent, junk).toBe('unknown');
    }
  });

  it('P2.2.1: centring is styling, not a fallback (a listed command that used to be rejected)', () => {
    expect(classifyIntent('center this element').intent).toBe('styling');
    expect(classifyIntent('center the div').intent).toBe('styling');
  });

  it('P2.2.1: the four required instructions keep their specific categories', () => {
    expect(classifyIntent('Add a JSDoc comment').intent).toBe('documentation');
    expect(classifyIntent('Rename this variable').intent).toBe('refactoring');
    expect(classifyIntent('Make this button green').intent).toBe('styling');
    expect(classifyIntent('Add loading state').intent).toBe('react');
  });

  it('does not fire a keyword embedded inside another word (word boundaries)', () => {
    // "type" must not fire inside "typewriter"; this instruction has no real category signal.
    expect(classifyIntent('describe the typewriter museum').intent).toBe('explanation'); // "describe"
    expect(classifyIntent('the typewriter museum').intent).toBe('unknown');
  });
});
