import type { Finding } from './analysis.js';

/**
 * Which languages the repair pipeline can act on, expressed as file extensions so the RENDERER can
 * answer "is this repairable at all?" without importing anything from main.
 *
 * This lives in the contract layer for one reason: the same question was previously answerable only
 * in main (`ai-service.ts`'s `EXT_LANGUAGE`), so the UI had no way to distinguish "this finding has
 * no fix" from "this file type is not supported" — the two states the user asked to see separately.
 * Kept in lockstep with that map by `language-for.test.ts`, which fails if the two ever disagree.
 */
const REPAIR_SUPPORTED_EXTENSIONS = new Set([
  'ts',
  'tsx',
  'mts',
  'cts',
  'js',
  'jsx',
  'mjs',
  'cjs',
  'py',
  'pyi',
  'go',
  'json',
  'css',
  'html',
  'htm',
]);

export function isRepairSupportedPath(path: string): boolean {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  return REPAIR_SUPPORTED_EXTENSIONS.has(ext);
}

/**
 * The repair state of a finding, as the UI presents it.
 *
 * Four states, not three, and the fourth is the point: `Finding.repair` is the ANALYZER's judgement
 * (does a fix exist for this rule?) and says nothing about whether the repair pipeline can act on the
 * file at all. Collapsing "no fix for this rule" and "no support for this file type" into one
 * disabled button meant the UI could not explain which of the two it was — the user saw a dead
 * control either way.
 *
 *  - `repairable`     — a deterministic fix exists; no model is involved.
 *  - `ai-repairable`  — no deterministic fix, but a model can propose one (verified before Apply).
 *  - `manual-only`    — the intended change is the author's to make; no machine should guess it.
 *  - `unsupported`    — the repair pipeline does not handle this file type.
 */
export type RepairState = 'repairable' | 'ai-repairable' | 'manual-only' | 'unsupported';

export function repairStateFor(finding: Finding): RepairState {
  // Language support is checked FIRST: an unsupported file cannot be repaired whatever the rule
  // says, so reporting the rule's classification there would describe a decision that never happens.
  if (!isRepairSupportedPath(finding.location.file)) return 'unsupported';
  if (finding.repair === 'safe-auto') return 'repairable';
  if (finding.repair === 'ai-required') return 'ai-repairable';
  return 'manual-only';
}

/** Whether Repair can be attempted at all. The two refusing states are refused for different reasons. */
export function isRepairAttemptable(state: RepairState): boolean {
  return state === 'repairable' || state === 'ai-repairable';
}

/** One sentence per state, for the button tooltip and the details pane. Never generic. */
export const REPAIR_STATE_REASON: Record<RepairState, string> = {
  repairable: 'A verified fix is available for this finding — no model needed.',
  'ai-repairable': 'Fixora can generate a fix for this finding and verify it before you apply it.',
  'manual-only':
    'This finding has no automatic or AI fix — the correct change needs your judgment, not a model.',
  unsupported: 'Fixora cannot repair this file type yet, so there is nothing to generate here.',
};

/** The short label shown on the finding row, so the state is visible without hovering anything. */
export const REPAIR_STATE_LABEL: Record<RepairState, string> = {
  repairable: 'Auto-fix',
  'ai-repairable': 'AI fix',
  'manual-only': 'Manual',
  unsupported: 'Unsupported',
};
