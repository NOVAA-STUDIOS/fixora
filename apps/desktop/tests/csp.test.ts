import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { assertCspIsSafe, buildCsp } from '../electron/main/security/csp.js';

/**
 * "CI asserts the CSP string contains no `unsafe-eval` and no `unsafe-inline` in script-src.
 * This is a hard gate — Monaco's default setup wants `unsafe-eval` and it is a common, quiet
 * capitulation. We don't make it." (TDD §3.2)
 *
 * This file is that gate. It is not testing that a string equals a string; it is testing that
 * a future engineer under deadline pressure cannot make Monaco's worker load by adding six
 * characters to a policy nobody re-reads.
 */

describe('the Content Security Policy', () => {
  const production = buildCsp('production');
  const development = buildCsp('development', 'http://localhost:5173');

  it('never permits unsafe-eval or an unsafe-inline script, in any environment', () => {
    // `unsafe-eval` is banned outright. `unsafe-inline` is banned specifically in `script-src` — the
    // Fast-Refresh preamble is allowed by a nonce instead (ADR-006). `style-src` keeps its inline
    // exemption (an inline style is not a script-execution primitive), so scope to script-src.
    const scriptSrc = (csp: string) => /script-src ([^;]*)/.exec(csp)?.[1] ?? '';
    expect(production).not.toContain('unsafe-eval');
    expect(development).not.toContain('unsafe-eval');
    expect(scriptSrc(production)).not.toContain('unsafe-inline');
    expect(scriptSrc(development)).not.toContain('unsafe-inline');
  });

  it('production ships exactly self; dev adds only a nonce for the Fast-Refresh preamble', () => {
    const scriptSrc = (csp: string) => /script-src ([^;]*)/.exec(csp)?.[1] ?? '';
    expect(scriptSrc(production)).toBe("'self'");
    expect(scriptSrc(development)).toBe("'self' 'nonce-fixora-dev-nonce'");
  });

  it('denies by default rather than allowing by default', () => {
    expect(production).toContain("default-src 'none'");
    expect(production).toContain("object-src 'none'");
    expect(production).toContain("frame-ancestors 'none'");
    expect(production).toContain("base-uri 'none'");
  });

  it('does not let the dev server widen production', () => {
    expect(production).toContain("connect-src 'self'");
    expect(production).not.toContain('localhost');
  });

  it('allows the dev server exactly the websocket it needs, and nothing more', () => {
    expect(development).toContain('connect-src');
    expect(development).toContain('http://localhost:5173');
    expect(development).toContain('ws://localhost:5173');
  });

  describe('assertCspIsSafe', () => {
    it('accepts the policy we ship', () => {
      expect(() => {
        assertCspIsSafe(production);
      }).not.toThrow();
    });

    it('rejects the capitulation', () => {
      expect(() => {
        assertCspIsSafe("default-src 'none'; script-src 'self' 'unsafe-eval'; object-src 'none'");
      }).toThrow(/unsafe-eval/);
    });

    it('rejects a policy that allows everything by default', () => {
      expect(() => {
        assertCspIsSafe("default-src *; script-src 'self'");
      }).toThrow(/default-src/);
    });
  });

  it('agrees with the meta tag shipped in index.html', () => {
    // Two locks, one key. A header and a meta tag that disagree is worse than either alone,
    // because the weaker one is the one that will actually be enforced somewhere.
    const html = readFileSync(join(import.meta.dirname, '..', 'index.html'), 'utf8');
    const meta = /http-equiv="Content-Security-Policy"\s+content="([^"]+)"/.exec(html)?.[1];

    expect(meta).toBeDefined();
    expect(meta).toBe(production);
  });
});
