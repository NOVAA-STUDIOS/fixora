import { normalizeMentionPath } from '../zappr/mention-context.js';

export type ZapprPaletteActionId = 'zappr.explain' | 'zappr.fix' | 'zappr.refactor' | 'zappr.tests' | 'zappr.review' | 'zappr.crossFileRepair';

export const ZAPPR_PALETTE_ACTIONS: { id: ZapprPaletteActionId; title: string; keywords: string[] }[] = [
  { id: 'zappr.explain', title: 'Explain selection or file', keywords: ['explain', 'understand', 'selection', 'active file'] },
  { id: 'zappr.fix', title: 'Fix errors', keywords: ['repair', 'debug', 'bug', 'approval'] },
  { id: 'zappr.refactor', title: 'Refactor selection', keywords: ['edit plan', 'clean up', 'approval'] },
  { id: 'zappr.tests', title: 'Generate tests', keywords: ['test', 'spec', 'create', 'approval'] },
  { id: 'zappr.review', title: 'Review file', keywords: ['code review', 'read only', 'findings'] },
  { id: 'zappr.crossFileRepair', title: 'Cross-file repair', keywords: ['related files', 'imports', 'types', 'consumers', 'approval'] },
];

export function buildZapprPalettePrompt(
  action: ZapprPaletteActionId,
  hasSelection: boolean,
): string {
  const subject = hasSelection ? 'the selected code' : 'the active file';
  switch (action) {
    case 'zappr.explain':
      return `Explain ${subject} clearly. Focus on behavior, important logic, and potential concerns. Do not propose file changes.`;
    case 'zappr.fix':
      return `Fix errors in ${subject} while preserving intended behavior. Make the smallest necessary repair and use the normal approval flow for changes.`;
    case 'zappr.refactor':
      return `Write a minimal edit plan to refactor ${subject}. Preserve behavior and unrelated code; propose only necessary changes for approval.`;
    case 'zappr.tests':
      return `Generate focused tests for ${subject} using the project's existing test conventions. Create or edit only necessary test files and require approval.`;
    case 'zappr.review':
      return 'Review this file. Report only actionable findings supported by its code and context; do not modify files.';
    case 'zappr.crossFileRepair':
      return `Repair this issue across related files where necessary, starting from ${subject}. Coordinate only directly affected imports, types, consumers, and focused tests. Keep the repair within the existing five-file limit and require approval.`;
  }
}

export type ZapprPaletteContext = {
  selectedCode: string | null;
  selectedCodeFile: string | null;
  selectedCodeStartLine: number | null;
  selectedCodeEndLine: number | null;
  selectedWorkspaceRoot: string | null;
  workspaceRoot: string | null;
  mentionFiles: readonly string[];
  activeFile: string | null;
};

/** Display only safe workspace-relative context; selected/mentioned context outranks active fallback. */
export function formatZapprPaletteContext(context: ZapprPaletteContext): string | null {
  if (context.selectedCode !== null && context.workspaceRoot !== null && context.selectedWorkspaceRoot === context.workspaceRoot) {
    const path = context.selectedCodeFile === null ? null : normalizeMentionPath(context.selectedCodeFile);
    const label = path ?? 'selected code';
    const range = context.selectedCodeStartLine === null
      ? ''
      : ` · lines ${String(context.selectedCodeStartLine)}–${String(context.selectedCodeEndLine ?? context.selectedCodeStartLine)}`;
    return `Context: ${label}${range}`;
  }
  const mentions = [...new Set(context.mentionFiles.map(normalizeMentionPath).filter((path): path is string => path !== null))];
  if (mentions.length > 0) {
    const visible = mentions.slice(0, 2).map((path) => `@${path}`);
    const more = mentions.length > visible.length ? ` · +${String(mentions.length - visible.length)} more` : '';
    return `Context: ${visible.join(' · ')}${more}`;
  }
  const active = context.activeFile === null ? null : normalizeMentionPath(context.activeFile);
  return active === null ? null : `Context: ${active}`;
}
