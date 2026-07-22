import type { Finding } from '@fixora/shared-types';
import { describe, expect, it } from 'vitest';

import { buildContext } from '../context/context-builder.js';

import { buildProviderRequest, profileWantsStructuredOutput } from './profiles.js';

const FILE = `export function greet(name: string): string {
  const msg = 'hi ' + name;
  return msg;
}
`;

const FINDING: Finding = {
  id: 'f1',
  source: 'eslint',
  ruleId: 'prefer-template',
  severity: 'warning',
  category: 'maintainability',
  location: { file: 'src/greet.ts', startLine: 2, startCol: 3, endLine: 2, endCol: 27 },
  message: 'Prefer template literals.',
  evidence: { snippet: "const msg = 'hi ' + name;", relatedLocations: [], toolOutput: {} },
  fixable: true,
  repair: 'ai-required',
  confidence: 1,
};

const context = buildContext({
  filePath: 'src/greet.ts',
  language: 'typescript',
  fileContent: FILE,
  finding: FINDING,
  target: { symbolName: 'greet', startLine: 1, endLine: 4 },
  conventions: ['test framework: vitest'],
});

describe('task profiles', () => {
  it('repair asks for schema-constrained JSON output and is low-temperature', () => {
    const request = buildProviderRequest('repair', context, { model: 'x', maxOutputTokens: 1000 });
    expect(request.responseSchema?.name).toBe('repair');
    expect(request.temperature).toBeLessThanOrEqual(0.2);
    expect(request.maxOutputTokens).toBe(1000);
    expect(profileWantsStructuredOutput('repair')).toBe(true);
  });

  it('test asks for schema-constrained JSON output', () => {
    const request = buildProviderRequest('test', context, { model: 'x' });
    expect(request.responseSchema?.name).toBe('test');
    expect(profileWantsStructuredOutput('test')).toBe(true);
  });

  it('explain streams prose — no response schema', () => {
    const request = buildProviderRequest('explain', context, { model: 'x' });
    expect(request.responseSchema).toBeUndefined();
    expect(profileWantsStructuredOutput('explain')).toBe(false);
  });

  it('every request is grounded: the user message carries the finding and the target symbol', () => {
    const request = buildProviderRequest('repair', context, { model: 'x' });
    const user = request.messages.find((m) => m.role === 'user');
    expect(user?.content).toContain('prefer-template'); // the grounded finding
    expect(user?.content).toContain('export function greet'); // the exact target
    expect(user?.content).toContain('test framework: vitest'); // conventions
    // System prompt forbids whole-file rewrites.
    const system = request.messages.find((m) => m.role === 'system');
    expect(system?.content.toLowerCase()).toContain('only the target symbol');
  });
});
