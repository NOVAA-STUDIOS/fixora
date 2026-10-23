import { describe, expect, it } from 'vitest';

import {
  buildZapprPalettePrompt,
  formatZapprPaletteContext,
  ZAPPR_PALETTE_ACTIONS,
} from './zappr-palette-actions.js';

describe('Zappr command palette actions', () => {
  it('offers the supported actions through the existing command registry', () => {
    expect(ZAPPR_PALETTE_ACTIONS.map(({ id }) => id)).toEqual([
      'zappr.explain', 'zappr.fix', 'zappr.refactor', 'zappr.tests', 'zappr.review', 'zappr.crossFileRepair',
    ]);
  });

  it('maps Explain to non-mutating chat and Fix to the normal repair request', () => {
    expect(buildZapprPalettePrompt('zappr.explain', true)).toMatch(/selected code.*Do not propose file changes/i);
    expect(buildZapprPalettePrompt('zappr.fix', false)).toMatch(/active file.*normal approval flow/i);
  });

  it('routes test generation, review, and bounded cross-file repair through mode-detectable prompts', () => {
    expect(buildZapprPalettePrompt('zappr.tests', true)).toMatch(/Generate focused tests.*require approval/i);
    expect(buildZapprPalettePrompt('zappr.review', false)).toMatch(/^Review this file.*do not modify files/i);
    expect(buildZapprPalettePrompt('zappr.crossFileRepair', true)).toMatch(/Repair this issue across related files.*five-file limit/i);
    expect(buildZapprPalettePrompt('zappr.refactor', true)).toMatch(/minimal edit plan/i);
  });

  it('shows relative selected context before mentions and active-file fallback', () => {
    const context = {
      selectedCode: 'const x = 1;',
      selectedCodeFile: 'src/foo.tsx',
      selectedCodeStartLine: 12,
      selectedCodeEndLine: 28,
      selectedWorkspaceRoot: 'C:/project',
      workspaceRoot: 'C:/project',
      mentionFiles: ['src/other.ts'],
      activeFile: 'src/active.ts',
    };
    expect(formatZapprPaletteContext(context)).toBe('Context: src/foo.tsx · lines 12–28');
    expect(formatZapprPaletteContext({ ...context, selectedCode: null })).toBe('Context: @src/other.ts');
    expect(formatZapprPaletteContext({ ...context, selectedCode: null, mentionFiles: [] })).toBe('Context: src/active.ts');
  });

  it('never displays absolute or stale-workspace paths', () => {
    const context = {
      selectedCode: 'x',
      selectedCodeFile: 'C:/private/source.ts',
      selectedCodeStartLine: null,
      selectedCodeEndLine: null,
      selectedWorkspaceRoot: 'C:/old',
      workspaceRoot: 'C:/new',
      mentionFiles: ['D:/outside.ts'],
      activeFile: 'D:/outside.ts',
    };
    expect(formatZapprPaletteContext(context)).toBeNull();
  });
});
