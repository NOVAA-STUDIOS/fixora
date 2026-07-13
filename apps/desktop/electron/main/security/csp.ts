/**
 * The Content Security Policy.
 *
 * `script-src 'self'` with **no `unsafe-eval` and no `unsafe-inline`** is the line ADR-006
 * commits us to and that most Electron apps quietly cross, because Monaco's default worker
 * setup asks for `unsafe-eval` and saying yes is one line. We don't. `csp.test.ts` asserts
 * the string, so the capitulation cannot happen by accident in a hurried PR.
 *
 * `style-src` permits `'unsafe-inline'` deliberately: Monaco and any CSS-in-JS at runtime
 * inject style attributes, and inline *styles* are not a script-execution primitive. Inline
 * *scripts* are, which is why `script-src` gets no such exemption.
 */

export type CspEnvironment = 'development' | 'production';

/** The dev server needs a websocket for HMR. It gets that and nothing else. */
export function buildCsp(environment: CspEnvironment, devServerOrigin?: string): string {
  const connect = ["'self'"];
  if (environment === 'development' && devServerOrigin !== undefined) {
    connect.push(devServerOrigin, devServerOrigin.replace(/^http/, 'ws'));
  }

  const directives = [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self' data:",
    `connect-src ${connect.join(' ')}`,
    "worker-src 'self' blob:",
    "media-src 'none'",
    "object-src 'none'",
    "frame-src 'none'",
    "child-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
  ];

  return directives.join('; ');
}

/**
 * A CSP that is never asserted is a CSP that drifts. This is the assertion, and it is called
 * at startup as well as from the test — a misconfigured policy should refuse to launch rather
 * than silently degrade the sandbox.
 */
export function assertCspIsSafe(csp: string): void {
  const scriptSrc = /script-src ([^;]*)/.exec(csp)?.[1] ?? '';

  if (scriptSrc.includes('unsafe-eval')) {
    throw new Error(
      "CSP regression: script-src contains 'unsafe-eval'. ADR-006 forbids it — Monaco is " +
        'configured to run without it. Do not relax the policy to make a worker load.',
    );
  }
  if (scriptSrc.includes('unsafe-inline')) {
    throw new Error("CSP regression: script-src contains 'unsafe-inline'.");
  }
  if (!csp.includes("default-src 'none'")) {
    throw new Error("CSP regression: default-src must be 'none' — allowlist, never denylist.");
  }
  if (!csp.includes("object-src 'none'")) {
    throw new Error("CSP regression: object-src must be 'none'.");
  }
  if (!csp.includes("frame-ancestors 'none'")) {
    throw new Error("CSP regression: frame-ancestors must be 'none'.");
  }
}
