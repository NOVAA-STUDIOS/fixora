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

  it('does not fire a keyword embedded inside another word (word boundaries)', () => {
    // "type" must not fire inside "typewriter"; this instruction has no real category signal.
    expect(classifyIntent('describe the typewriter museum').intent).toBe('explanation'); // "describe"
    expect(classifyIntent('the typewriter museum').intent).toBe('unknown');
  });
});
