import { describe, expect, it } from 'vitest';

import { buildEditContext, type EditContextInput } from './edit-context.js';
import { buildEditRequest, prepareEditRequest } from './edit-request.js';

/**
 * The edit request builder must produce a schema-constrained request, and — critically — the SAME
 * secret gate the repair pipeline uses must run before an edit can leave: a target scope carrying a
 * secret is refused, never sent. This is the structural "nothing leaves without the gate" property.
 */

function ctxInput(over: Partial<EditContextInput> = {}): EditContextInput {
  return {
    instruction: 'rename this function to totalCents',
    intent: 'refactoring',
    filePath: 'src/pay.ts',
    language: 'typescript',
    target: {
      symbolName: 'total',
      startLine: 1,
      endLine: 3,
      text: 'function total(n) {\n  return n;\n}',
    },
    ...over,
  };
}

describe('buildEditRequest', () => {
  it('is schema-constrained to the edit schema, low-temperature, with a system + user message', () => {
    const req = buildEditRequest(buildEditContext(ctxInput()), {
      model: 'm',
      maxOutputTokens: 4000,
    });
    expect(req.responseSchema?.name).toBe('edit');
    expect(req.temperature).toBe(0.1);
    expect(req.messages[0]?.role).toBe('system');
    expect(req.messages[1]?.role).toBe('user');
    expect(req.messages[1]?.content).toContain('rename this function to totalCents');
    expect(req.messages[1]?.content).toContain('edit THIS only');
  });
});

describe('prepareEditRequest — the gate cannot be bypassed', () => {
  it('prepares a request for benign content', () => {
    const prepared = prepareEditRequest(buildEditContext(ctxInput()), { model: 'm' });
    expect(prepared.ok).toBe(true);
  });

  it('BLOCKS when the target scope contains a secret — nothing is sent', () => {
    const withSecret = ctxInput({
      target: {
        symbolName: 'config',
        startLine: 1,
        endLine: 1,
        text: 'const awsKey = "AKIAIOSFODNN7EXAMPLE";',
      },
    });
    const prepared = prepareEditRequest(buildEditContext(withSecret), { model: 'm' });
    expect(prepared.ok).toBe(false);
    if (!prepared.ok) expect(prepared.blocked.length).toBeGreaterThan(0);
  });
});
