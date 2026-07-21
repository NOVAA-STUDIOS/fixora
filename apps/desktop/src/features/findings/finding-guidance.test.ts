import type { Finding, FindingSource } from '@fixora/shared-types';
import { describe, expect, it } from 'vitest';

import {
  CATEGORY_GUIDANCE,
  docsLinkFor,
  effortFor,
  manualFixFor,
  riskLevelFor,
  whyTriggered,
} from './finding-guidance.js';

/**
 * The details panel's docs link and the main process's `openExternal` allowlist are two files that
 * have to agree: a link this module emits is opened through that guard, and a host the guard does
 * not know is *refused* — the user clicks and nothing happens. That is a silent failure, so it is
 * pinned here rather than discovered in the field. Adding a source with a new docs host must fail
 * this test until the host is added to the guard deliberately (Security §2).
 */

// Kept in sync with ALLOWED_EXTERNAL_HOSTS in electron/main/security/navigation-guard.ts.
const ALLOWED_HOSTS = [
  'fixora.dev',
  'github.com',
  'eslint.org',
  'docs.astral.sh',
  'mypy.readthedocs.io',
  'pkg.go.dev',
  'semgrep.dev',
];

const ALL_SOURCES: FindingSource[] = [
  'eslint',
  'tsc',
  'ruff',
  'mypy',
  'go-vet',
  'semgrep',
  'complexity',
  'ai',
];

function finding(over: Partial<Finding> = {}): Finding {
  return {
    id: 'f1',
    source: 'eslint',
    ruleId: 'no-eval',
    severity: 'error',
    category: 'security',
    location: { file: 'src/a.ts', startLine: 1, startCol: 1, endLine: 1, endCol: 2 },
    message: 'eval is evil',
    evidence: { snippet: 'eval(x)', relatedLocations: [], toolOutput: null },
    fixable: false,
    repair: 'ai-required',
    confidence: 1,
    ...over,
  };
}

describe('docsLinkFor', () => {
  it('only ever emits https URLs on hosts the navigation guard allows', () => {
    for (const source of ALL_SOURCES) {
      const link = docsLinkFor(finding({ source, ruleId: 'some.rule-id' }));
      if (link === null) continue;
      const url = new URL(link.href);
      expect(url.protocol).toBe('https:');
      expect(ALLOWED_HOSTS).toContain(url.hostname);
    }
  });

  it('deep-links a core ESLint rule', () => {
    expect(docsLinkFor(finding({ ruleId: 'no-eval' }))?.href).toBe(
      'https://eslint.org/docs/latest/rules/no-eval',
    );
  });

  it('stays silent for an ESLint plugin rule rather than guessing a docs host', () => {
    expect(docsLinkFor(finding({ ruleId: '@typescript-eslint/no-explicit-any' }))).toBeNull();
  });

  it('cannot be steered off-host by a hostile rule id', () => {
    const link = docsLinkFor(finding({ ruleId: '../../../evil.example.com' }));
    // Either refused outright, or kept on eslint.org with the id escaped into a single segment.
    if (link !== null) expect(new URL(link.href).hostname).toBe('eslint.org');
  });

  it('has no docs link for sources without a stable per-rule page', () => {
    expect(docsLinkFor(finding({ source: 'tsc', ruleId: 'TS2304' }))).toBeNull();
    expect(docsLinkFor(finding({ source: 'complexity', ruleId: 'cyclomatic' }))).toBeNull();
  });
});

describe('CATEGORY_GUIDANCE', () => {
  it('covers every category with non-empty prose', () => {
    for (const g of Object.values(CATEGORY_GUIDANCE)) {
      expect(g.what.length).toBeGreaterThan(20);
      expect(g.ifIgnored.length).toBeGreaterThan(20);
      expect(g.fix.length).toBeGreaterThan(20);
    }
  });
});

describe('derived risk and effort', () => {
  it('ranks a security error highest and style lowest', () => {
    expect(riskLevelFor(finding({ category: 'security', severity: 'error' }))).toBe('critical');
    expect(riskLevelFor(finding({ category: 'security', severity: 'warning' }))).toBe('high');
    expect(riskLevelFor(finding({ category: 'correctness', severity: 'error' }))).toBe('high');
    // Style has no runtime effect by definition, so it is capped low whatever the severity.
    expect(riskLevelFor(finding({ category: 'style', severity: 'error' }))).toBe('low');
  });

  it('calls a tool-fixable finding automatic, whatever else it is', () => {
    expect(effortFor(finding({ fixable: true })).label).toBe('Automatic');
  });

  it('scales complexity effort by how far past the threshold it sits', () => {
    const near = effortFor(
      finding({
        source: 'complexity',
        ruleId: 'cyclomatic-complexity',
        location: { file: 'a.ts', startLine: 1, startCol: 1, endLine: 30, endCol: 1 },
        evidence: {
          snippet: 'function f',
          relatedLocations: [],
          toolOutput: { metric: 'cyclomatic-complexity', value: 12, threshold: 11 },
        },
      }),
    );
    expect(near.label).toBe('Moderate');

    const far = effortFor(
      finding({
        source: 'complexity',
        ruleId: 'cyclomatic-complexity',
        location: { file: 'a.ts', startLine: 1, startCol: 1, endLine: 300, endCol: 1 },
        evidence: {
          snippet: 'function f',
          relatedLocations: [],
          toolOutput: { metric: 'cyclomatic-complexity', value: 40, threshold: 11 },
        },
      }),
    );
    expect(far.label).toBe('Larger');
  });

  it('survives a toolOutput that is not the shape it expects', () => {
    const odd = finding({
      source: 'complexity',
      evidence: { snippet: 'x', relatedLocations: [], toolOutput: 'not an object' },
    });
    // Degrades to the generic path rather than throwing in the render.
    expect(() => effortFor(odd)).not.toThrow();
    expect(() => whyTriggered(odd)).not.toThrow();
  });
});

describe('whyTriggered', () => {
  it('quotes the real numbers for a measured finding', () => {
    const text = whyTriggered(
      finding({
        source: 'complexity',
        evidence: {
          snippet: 'function f',
          relatedLocations: [],
          toolOutput: { metric: 'cyclomatic-complexity', value: 12, threshold: 11 },
        },
      }),
    );
    expect(text).toContain('12');
    expect(text).toContain('11');
  });

  it('attributes a tool finding to the tool rather than claiming its own analysis', () => {
    const text = whyTriggered(finding({ source: 'eslint', message: 'eval is evil' }));
    expect(text).toContain('ESLint');
    expect(text).toContain('eval is evil');
  });
});

describe('manualFixFor', () => {
  it('gives the unambiguous remedy for a known rule family', () => {
    expect(manualFixFor(finding({ ruleId: 'eqeqeq' })).strategy).toContain('===');
    // Plugin scoping must not defeat the lookup.
    expect(manualFixFor(finding({ ruleId: '@typescript-eslint/eqeqeq' })).strategy).toContain(
      '===',
    );
  });

  it('falls back to the category strategy for a rule it does not know', () => {
    const fix = manualFixFor(
      finding({ ruleId: 'some-rule-we-have-never-seen', category: 'style' }),
    );
    expect(fix.strategy).toBe(CATEGORY_GUIDANCE.style.fix);
    // No fabricated code sample for a rule we know nothing about.
    expect(fix.illustration).toBeUndefined();
  });
});
