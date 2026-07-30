import type { RepairMode } from '@fixora/shared-types';

/**
 * How much of the user's file a patch actually touches, as a single at-a-glance signal.
 *
 * Derived, never declared. Mode alone is not impact: a `finding` repair on a 200-line React component
 * changes far more than a `related-scope` one on a three-line helper. What the user needs to know
 * before pressing Apply is *how much code moves*, so that is what this measures — with the one
 * exception that whole-file mode is always High, because replacing the file is the largest edit the
 * app can make regardless of how short the file happens to be.
 */

export type ImpactLevel = 'low' | 'medium' | 'high';

/** Above this many lines a patch stops being a local edit and starts being a rewrite. */
const MEDIUM_THRESHOLD = 10;
const HIGH_THRESHOLD = 50;

export interface RepairImpact {
  level: ImpactLevel;
  /** The line count the level was derived from — shown so the rating is never unexplained. */
  lines: number;
  /** Four or five words. The card has no room for a sentence, and does not need one. */
  summary: string;
}

export function repairImpact(mode: RepairMode | undefined, lines: number): RepairImpact {
  if (mode === 'ai-file') {
    return { level: 'high', lines, summary: `Whole file · ${String(lines)} lines` };
  }
  if (lines > HIGH_THRESHOLD) {
    return { level: 'high', lines, summary: `${String(lines)} lines replaced` };
  }
  if (lines > MEDIUM_THRESHOLD) {
    return { level: 'medium', lines, summary: `${String(lines)} lines replaced` };
  }
  return {
    level: 'low',
    lines,
    summary: `${String(lines)} line${lines === 1 ? '' : 's'} replaced`,
  };
}

export const IMPACT_LABEL: Record<ImpactLevel, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
};

/**
 * The indicator dot, in the same visual language the findings list already uses for severity — a
 * filled colour dot rather than an emoji glyph, so it inherits the app's palette in both themes and
 * stays legible at 10px.
 */
export const IMPACT_DOT: Record<ImpactLevel, string> = {
  low: 'bg-success',
  medium: 'bg-warn',
  high: 'bg-danger',
};

export const IMPACT_TEXT: Record<ImpactLevel, string> = {
  low: 'text-success-text',
  medium: 'text-warn-text',
  high: 'text-danger-text',
};
