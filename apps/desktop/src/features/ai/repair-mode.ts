import type { RepairMode } from '@fixora/shared-types';

/**
 * The repair modes, as the UI presents them.
 *
 * The ladder is ordered by blast radius, and that ordering is the safety model: the splice range IS
 * what a wrong patch can damage, so every step up is an explicit choice the user makes, never an
 * escalation the app performs. `finding` stays the default for exactly that reason.
 */

export interface RepairModeInfo {
  readonly mode: RepairMode;
  readonly label: string;
  /** What this mode will change, in one line, before it is chosen. */
  readonly description: string;
  /** Shown in the panel while a proposal from this mode is on screen. */
  readonly scopeLabel: string;
  /** True for modes that must be confirmed before running and never selected automatically. */
  readonly advanced: boolean;
  /** The warning shown before running. Present only for advanced modes. */
  readonly warning?: string;
}

export const REPAIR_MODES: readonly RepairModeInfo[] = [
  {
    mode: 'finding',
    label: 'Repair Finding',
    description: 'The smallest validated patch — only the code around the selected problem.',
    scopeLabel: 'Selected finding only',
    advanced: false,
  },
  {
    mode: 'related-scope',
    label: 'Repair Related Scope',
    description:
      'Fixes the selected problem plus any directly related problems inside the same scope. The patch covers the same lines either way.',
    scopeLabel: 'Selected finding + related issues in the same scope',
    advanced: false,
  },
  {
    mode: 'ai-file',
    label: 'AI File Repair (Advanced)',
    description:
      'Rewrites the entire file to fix every repairable problem the analyzer found in it.',
    scopeLabel: 'Entire file',
    advanced: true,
    warning:
      'This replaces the WHOLE FILE, not just the code around one problem — the largest change Fixora can make, and the most that can go wrong in one step. It is still verified before you can apply it, and you will review the full diff first. Nothing is written until you press Apply.',
  },
  {
    mode: 'advanced',
    label: 'Advanced Repair',
    description:
      'Collects every problem in the file and sends them to the AI together in one request, so it can resolve issues that depend on each other rather than fixing them one at a time. Re-verifies the whole file afterward and retries once, automatically, if anything is still wrong.',
    scopeLabel: 'Entire file — every repairable problem, fixed together',
    advanced: true,
    warning:
      'This replaces the WHOLE FILE, not just the code around one problem — the largest change Fixora can make, and the most that can go wrong in one step. It is still verified before you can apply it, and you will review the full diff first. Nothing is written until you press Apply.',
  },
];

export const DEFAULT_REPAIR_MODE: RepairMode = 'finding';

export function repairModeInfo(mode: RepairMode | undefined): RepairModeInfo {
  const found = REPAIR_MODES.find((m) => m.mode === (mode ?? DEFAULT_REPAIR_MODE));
  // The array is a non-empty literal, so this fallback is unreachable in practice — it exists so the
  // return type needs no assertion.
  return (
    found ?? {
      mode: 'finding',
      label: 'Repair Finding',
      description: '',
      scopeLabel: 'Selected finding only',
      advanced: false,
    }
  );
}
