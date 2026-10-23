import { describe, expect, it } from 'vitest';

import { normalizeZapprPath, parsePlan } from '../electron/main/services/zappr-service.js';

describe('Zappr plan validation', () => {
  it('parses a valid shared-schema plan', () => {
    expect(parsePlan(JSON.stringify({
      summary: 'create a file',
      steps: [{ type: 'create', filePath: 'src/new.ts', description: 'new file', content: 'export {};' }],
    }))).toEqual({
      summary: 'create a file',
      steps: [{ type: 'create', filePath: 'src/new.ts', description: 'new file', content: 'export {};' }],
    });
  });

  it('rejects a schema-invalid plan', () => {
    expect(() => parsePlan(JSON.stringify({ summary: 'bad', steps: [{ type: 'copy', filePath: 'x', description: '' }] })))
      .toThrow('invalid file plan');
  });

  it('does not salvage malformed or truncated JSON', () => {
    expect(() => parsePlan('{"summary":"bad","steps":[{"type":"create","filePath":"x","description":"x","content":"unterminated'))
      .toThrow('invalid file plan');
  });
});

describe('Zappr workspace paths', () => {
  it.each(['/absolute.ts', 'C:\\absolute.ts', '../escape.ts', 'nested/../../escape.ts', ''])('rejects unsafe path %s', (path) => {
    expect(() => normalizeZapprPath(path)).toThrow('unsafe workspace path');
  });

  it('accepts and normalizes a nested relative path', () => {
    expect(normalizeZapprPath('src\\components\\Button.tsx')).toBe('src/components/Button.tsx');
  });
});
