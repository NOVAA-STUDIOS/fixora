import type { Finding } from '@fixora/shared-types';
import { describe, expect, it } from 'vitest';

import { buildContext, type ContextInput } from '../context/context-builder.js';

import { prepareRequest } from './prepare.js';

function inputWithTarget(fileContent: string): ContextInput {
  const finding: Finding = {
    id: 'f1',
    source: 'eslint',
    ruleId: 'some-rule',
    severity: 'error',
    category: 'correctness',
    location: { file: 'src/x.ts', startLine: 1, startCol: 1, endLine: 3, endCol: 1 },
    message: 'something',
    evidence: { snippet: fileContent, relatedLocations: [], toolOutput: {} },
    fixable: false,
    confidence: 1,
  };
  return {
    filePath: 'src/x.ts',
    language: 'typescript',
    fileContent,
    finding,
    target: { symbolName: 'run', startLine: 1, endLine: 3 },
  };
}

describe('prepareRequest — the gate runs before every provider request', () => {
  it('produces a provider request for clean context', () => {
    const context = buildContext(inputWithTarget('export function run() {\n  return 1;\n}\n'));
    const prepared = prepareRequest('repair', context, { model: 'anthropic/claude-3.5-sonnet' });
    expect(prepared.ok).toBe(true);
    if (prepared.ok) expect(prepared.request.messages.length).toBe(2);
  });

  it('BLOCKS when the target code contains a secret — nothing is sent', () => {
    // A live-looking AWS key smuggled into the very code we would repair.
    const withSecret = 'export function run() {\n  const k = "AKIAIOSFODNN7EXAMPLE";\n  return k;\n}';
    const context = buildContext(inputWithTarget(withSecret));
    const prepared = prepareRequest('repair', context, { model: 'x' });
    expect(prepared.ok).toBe(false);
    if (prepared.ok) return;
    expect(prepared.blocked.some((m) => m.rule === 'aws-access-key-id')).toBe(true);
  });

  it('BLOCKS when a secret hides in a neighbour, not the target', () => {
    const context = buildContext({
      ...inputWithTarget('export function run() {\n  return 1;\n}\n'),
      neighbours: [{ label: 'config.ts', text: 'export const TOKEN = "ghp_012345678901234567890123456789abcdef";' }],
    });
    const prepared = prepareRequest('explain', context, { model: 'x' });
    expect(prepared.ok).toBe(false);
    if (prepared.ok) return;
    expect(prepared.blocked.some((m) => m.label === 'config.ts')).toBe(true);
  });
});
