import type { Language, RepairStrategy } from '@fixora/shared-types';

/**
 * The Repair Eligibility Engine (P0.1 Part 2).
 *
 * Every repair request produces this decision object BEFORE any model is called, so the answer to
 * "why is Repair unavailable?" is always a value, never a shrug. It composes the only things repair
 * availability is allowed to depend on (Part 4): language support, rule/repairability, and model
 * capability — never a folder name, drive letter, or workspace layout. When `repairable` is false the
 * `reason` is specific and actionable; there is no path that returns a generic message.
 */

/** How a repair would be produced, once eligible. `deterministic` needs no model; `ai` does. */
export type RepairMethod = 'deterministic' | 'ai' | null;

export interface RepairEligibility {
  repairable: boolean;
  language: Language | null;
  provider: string | null;
  model: string | null;
  /** The model capability this repair needs, when it needs one. */
  capability: 'repair' | null;
  repairability: RepairStrategy;
  /** How the repair would be generated — a micro-repair (deterministic) or a model call (ai). */
  method: RepairMethod;
  /** Precise, actionable reason when `repairable` is false; null when true. */
  reason: string | null;
}

export interface RepairEligibilityInput {
  /** The finding's language, or null when the file's extension is not one Fixora analyzes. */
  language: Language | null;
  ruleId: string;
  /** The finding's repairability, set by the analyzer (classifyRepair). */
  repairability: RepairStrategy;
  provider: string | null;
  model: string | null;
  /**
   * Whether the selected model supports the `repair` profile: true / false / null when the capability
   * could not be determined (e.g. the model catalogue was unreachable). Only consulted for ai-required
   * findings.
   */
  repairCapable: boolean | null;
  /** The capability layer's own reason when `repairCapable` is false — surfaced verbatim. */
  repairCapabilityReason?: string;
}

/** The languages the repair pipeline can target. Kept explicit so a gap is a decision, not a silent no. */
const REPAIRABLE_LANGUAGES = new Set<Language>([
  'typescript',
  'javascript',
  'python',
  'json',
  'go',
  // Tier-B validation languages. Their repairs are verified by syntax + regression checks only (no
  // linter or type checker for either ships in this stack), which are real gates — a css/html repair
  // that does not parse is refused — but narrower than the tsc/eslint/ruff ones.
  'css',
  'html',
]);

export function evaluateRepairEligibility(input: RepairEligibilityInput): RepairEligibility {
  const base = {
    language: input.language,
    provider: input.provider,
    model: input.model,
    repairability: input.repairability,
  };

  if (input.language === null || !REPAIRABLE_LANGUAGES.has(input.language)) {
    return {
      ...base,
      repairable: false,
      capability: null,
      method: null,
      reason:
        'Unsupported file type — Fixora repairs TypeScript, JavaScript, React, Python, Go, JSON, CSS and HTML. This file is none of those.',
    };
  }

  if (input.repairability === 'manual') {
    return {
      ...base,
      repairable: false,
      capability: null,
      method: null,
      reason: `The rule ${input.ruleId} has no automatic or AI fix — its correct change is one only you can make (e.g. the intended name or type is unknowable to a tool).`,
    };
  }

  // A tool shipped a deterministic fix: repairable with no model at all.
  if (input.repairability === 'safe-auto') {
    return { ...base, repairable: true, capability: null, method: 'deterministic', reason: null };
  }

  // ai-required: the decision now depends on the model.
  if (input.model === null) {
    return {
      ...base,
      repairable: false,
      capability: null,
      method: null,
      reason: 'No model is selected. Choose one in Settings → AI to enable AI repairs.',
    };
  }
  if (input.repairCapable === false) {
    return {
      ...base,
      repairable: false,
      capability: null,
      method: null,
      reason:
        input.repairCapabilityReason ??
        `The model ${input.model} lacks repair capability — it cannot return a structured repair, so Fixora will not guess one.`,
    };
  }
  if (input.repairCapable === null) {
    return {
      ...base,
      repairable: false,
      capability: null,
      method: null,
      reason: `The repair capability of ${input.model} could not be determined (the model catalogue was unreachable). Repair is disabled rather than attempted blindly.`,
    };
  }

  return { ...base, repairable: true, capability: 'repair', method: 'ai', reason: null };
}
