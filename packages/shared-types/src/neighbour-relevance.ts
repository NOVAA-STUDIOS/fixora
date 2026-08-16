/**
 * How relevant one piece of context is to a finding — the single scoring rule, shared.
 *
 * It lives in the contract layer, not in `core-analysis` where it started, because BOTH sides need
 * it and they cannot share code any other way: `core-analysis` is ESM-only and the Electron main
 * process is CJS, so main can only reach it through `await import()` (see `ai-service.ts`), and
 * `repairNeighbours` — which does the final ranking — is synchronous. `shared-types` is the one
 * package main already value-imports statically. Duplicating the function instead would put the
 * ranking rule in two places and let them drift silently.
 *
 * Two signals, both cheap, both derived from what the finding already carries:
 *
 *  - **Named in the diagnostic** (+10) — the dominant signal. When a tool says
 *    `Property 'x' does not exist on type 'Settings'`, `interface Settings` is the context that
 *    answers it, and it should outrank anything merely nearby.
 *  - **Proximity** (+0..5) — decays with distance. Capped at half the reference bonus, so a named
 *    candidate always beats an unnamed one however far away it is.
 */
export function neighbourRelevanceScore(
  label: string,
  /**
   * Where the candidate sits in the finding's own file, or `null` for cross-file context — which
   * has no line in this file, so the proximity term does not apply to it. That is the honest
   * reading rather than a penalty: a foreign definition is neither near nor far, and scoring it on
   * a line number it does not have would be inventing a signal.
   */
  startLine: number | null,
  findingLine: number,
  diagnosticText: string,
): number {
  let score = 0;

  // Labels look like `import from 'react'`, `interface Settings`, `from './types': interface User`.
  // The identifier is the last word, which is exactly what a tool's message names when it names
  // anything.
  const name = label.split(/[\s':]+/).filter(Boolean).pop() ?? '';
  if (name !== '' && diagnosticText.includes(name)) score += 10;

  if (startLine !== null) {
    const distance = Math.abs(startLine - findingLine);
    score += Math.max(0, 5 - Math.floor(distance / 20));
  }

  return score;
}
