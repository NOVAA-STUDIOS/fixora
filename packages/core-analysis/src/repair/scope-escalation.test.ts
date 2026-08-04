import { describe, expect, it } from 'vitest';

import type { RepairScope } from '../analyzer.js';

import { widenRepairScope } from './scope-escalation.js';

/**
 * The shape under test, using the production case:
 *
 * ```ts
 *  9  async function load(url) {          <- function scope, lines 9-13
 * 10    const response = fetch(url);      <- declaration scope, line 10 (the prerequisite)
 * 11    const data = response.json();     <- declaration scope, line 11 (the repair target)
 * 12    return data;
 * 13  }
 * ```
 *
 * Widening from line 11 must land on the function, because that is the smallest scope that contains
 * the prerequisite too — and it must never reach past `function` on its own.
 */
const SCOPES: readonly RepairScope[] = [
  { startLine: 10, endLine: 10, level: 'declaration' },
  { startLine: 11, endLine: 11, level: 'declaration' },
  { startLine: 12, endLine: 12, level: 'statement' },
  { startLine: 9, endLine: 13, level: 'function' },
  { startLine: 1, endLine: 40, level: 'class' },
];

describe('widenRepairScope', () => {
  it('climbs from the failing statement to the function that contains the prerequisite', () => {
    const wider = widenRepairScope({ scopes: SCOPES, current: { startLine: 11, endLine: 11 } });
    expect(wider).toEqual({ startLine: 9, endLine: 13, level: 'function' });
  });

  it('honours an explicit prerequisite line outside the current range', () => {
    const wider = widenRepairScope({
      scopes: SCOPES,
      current: { startLine: 11, endLine: 11 },
      mustInclude: [10],
    });
    // Line 10's own declaration scope does not contain line 11, so it cannot be the answer.
    expect(wider).toEqual({ startLine: 9, endLine: 13, level: 'function' });
  });

  it('never returns a scope with the same bounds — that is the ask that just failed', () => {
    const wider = widenRepairScope({
      scopes: [{ startLine: 11, endLine: 11, level: 'declaration' }],
      current: { startLine: 11, endLine: 11 },
    });
    expect(wider).toBeNull();
  });

  it('stops at the function cap rather than escalating into a class rewrite', () => {
    // Only the class contains the range, and it is above the default cap.
    const wider = widenRepairScope({
      scopes: [{ startLine: 1, endLine: 40, level: 'class' }],
      current: { startLine: 11, endLine: 11 },
    });
    expect(wider).toBeNull();
  });

  it('will reach a class only when the caller explicitly raises the cap', () => {
    const wider = widenRepairScope({
      scopes: [{ startLine: 1, endLine: 40, level: 'class' }],
      current: { startLine: 11, endLine: 11 },
      maxLevel: 'class',
    });
    expect(wider).toEqual({ startLine: 1, endLine: 40, level: 'class' });
  });

  it('picks the SMALLEST qualifying scope, not merely the first', () => {
    const wider = widenRepairScope({
      scopes: [
        { startLine: 1, endLine: 30, level: 'function' },
        { startLine: 9, endLine: 13, level: 'function' },
        { startLine: 5, endLine: 20, level: 'function' },
      ],
      current: { startLine: 11, endLine: 11 },
    });
    expect(wider).toEqual({ startLine: 9, endLine: 13, level: 'function' });
  });

  it('escalates step by step — a second call widens again from the new range', () => {
    const first = widenRepairScope({ scopes: SCOPES, current: { startLine: 11, endLine: 11 } });
    expect(first?.level).toBe('function');
    const second = widenRepairScope({
      scopes: SCOPES,
      current: { startLine: first?.startLine ?? 0, endLine: first?.endLine ?? 0 },
      maxLevel: 'class',
    });
    expect(second).toEqual({ startLine: 1, endLine: 40, level: 'class' });
  });

  it('returns null when the file yielded no scopes at all', () => {
    expect(
      widenRepairScope({ scopes: [], current: { startLine: 11, endLine: 11 } }),
    ).toBeNull();
  });

  it('never returns a scope that fails to cover the prerequisite', () => {
    const wider = widenRepairScope({
      scopes: [
        { startLine: 9, endLine: 13, level: 'function' },
        { startLine: 1, endLine: 40, level: 'class' },
      ],
      current: { startLine: 11, endLine: 11 },
      // A prerequisite far above the function forces the class, not the function.
      mustInclude: [3],
      maxLevel: 'class',
    });
    expect(wider).toEqual({ startLine: 1, endLine: 40, level: 'class' });
  });
});
