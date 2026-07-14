import * as axe from 'axe-core';

/**
 * Run axe-core against a rendered container and return its **critical and serious** violations.
 *
 * The M1 acceptance criterion is "axe-core reports zero critical violations". We assert on
 * critical *and* serious, because "serious" is where keyboard-operability and contrast failures
 * land, and our users are keyboard users (Standards §3). We do not use the young `vitest-axe`
 * wrapper (0.1.0) — axe-core has a stable API and one fewer dependency in the test path is one
 * fewer thing to break.
 */
export async function axeViolations(container: Element): Promise<axe.Result[]> {
  const results = await axe.run(container, {
    resultTypes: ['violations'],
    // jsdom does not compute layout, so colour-contrast (which needs rendered pixels) cannot be
    // evaluated here — that is the token contrast gate's job, and it does it better. Disable it
    // rather than let it report false negatives that lull us.
    rules: { 'color-contrast': { enabled: false } },
  });
  return results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious');
}

/** A readable failure message: which rule, on which node, and how to fix it. */
export function formatViolations(violations: axe.Result[]): string {
  return violations
    .map((v) => {
      const nodes = v.nodes.map((n) => `      ${n.html}`).join('\n');
      return `  [${v.impact ?? '?'}] ${v.id}: ${v.help}\n${nodes}\n    ${v.helpUrl}`;
    })
    .join('\n');
}
