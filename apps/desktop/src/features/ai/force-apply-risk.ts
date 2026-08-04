import type { AiProposal } from '@fixora/shared-types';

import { evaluateApplyGate } from './apply-diagnostics.js';

/**
 * What the user is agreeing to when they force an unverified patch through.
 *
 * Force Apply exists because the verifier is sometimes wrong about a patch the author can see is
 * right — a grammar older than the language, an analyzer the project configures differently, a lint
 * rule the repo does not care about. Refusing outright would make Fixora a tool that overrules the
 * person using it. But an escape hatch that says only "are you sure?" is not consent, it is a shrug:
 * the user cannot weigh a risk nobody described.
 *
 * So this turns the verification report into the three things a decision actually needs — WHAT failed,
 * HOW risky it is, and WHAT MAY HAPPEN to the file — in the same terms for every language, because it
 * reads the verifier's report rather than the source. A CSS regression and a Python type error produce
 * the same shape of briefing.
 *
 * ## It changes nothing
 *
 * This is presentation. It does not evaluate, re-run, or soften any gate: `evaluateApplyGate` remains
 * the sole authority on whether **Accept** is offered, and forcing does not touch the write-time
 * protections — the staleness check, the range validation and the path guard all still run inside
 * `ai:applyRepair` and can still refuse the write. Force Apply bypasses the verification gate and
 * nothing else.
 */

export type RiskLevel = 'low' | 'medium' | 'high';

export interface ForceApplyRisk {
  /** True when the patch passed its gates — Accept is the right action and forcing is unnecessary. */
  readonly verified: boolean;
  readonly level: RiskLevel;
  /** The failure class, in the user's words. */
  readonly headline: string;
  /** The verifier's own diagnostic, verbatim where there is one. */
  readonly detail: string;
  /** What may happen to the file if this is applied anyway. Concrete, never "may cause issues". */
  readonly consequences: readonly string[];
}

const RISK_LABEL: Record<RiskLevel, string> = {
  low: 'Low risk',
  medium: 'Medium risk',
  high: 'High risk',
};

export function riskLabel(level: RiskLevel): string {
  return RISK_LABEL[level];
}

type Repair = Extract<AiProposal, { profile: 'repair' }>;

/** How many new findings came from each class of analyzer — the basis for the risk rating. */
function classify(proposal: Repair): { type: number; lint: number; other: number; total: number } {
  const findings = proposal.verification.newFindings ?? [];
  let type = 0;
  let lint = 0;
  let other = 0;
  for (const f of findings) {
    const source = f.source.toLowerCase();
    if (source === 'tsc' || source === 'mypy') type += 1;
    else if (source === 'eslint' || source === 'ruff') lint += 1;
    else other += 1;
  }
  return { type, lint, other, total: findings.length };
}

/**
 * Describe the risk of forcing this patch.
 *
 * The ordering mirrors the gate's own precedence — a file that does not parse is the worst case and
 * is reported first, because nothing downstream of it is meaningful.
 */
export function assessForceApplyRisk(proposal: Repair | null): ForceApplyRisk | null {
  if (proposal === null) return null;
  const gate = evaluateApplyGate(proposal);
  const report = proposal.verification;

  if (gate.enabled) {
    return {
      verified: true,
      level: 'low',
      headline: 'This repair passed verification',
      detail: gate.explanation,
      consequences: [],
    };
  }

  if (gate.reason === 'empty-patch' || gate.reason === 'no-proposal') {
    return {
      verified: false,
      level: 'high',
      headline: 'There is nothing to apply',
      detail: gate.explanation,
      // Not a risk judgement — there is genuinely no content, so forcing cannot do anything useful.
      consequences: ['Applying this would replace the target range with nothing, deleting that code.'],
    };
  }

  // Parser failure — the most serious, and the only one that is certain rather than probable.
  if (!report.syntaxOk) {
    const where =
      report.syntaxError === undefined
        ? ''
        : ` The parser stopped at line ${String(report.syntaxError.line)}, column ${String(
            report.syntaxError.column,
          )}: ${report.syntaxError.text}`;
    return {
      verified: false,
      level: 'high',
      headline: 'The patched file does not parse',
      detail: `This is not a judgement call — the file would be syntactically broken.${where}`,
      consequences: [
        'The file will not compile, run, or be importable by anything that depends on it.',
        'Editors and language tooling will report errors throughout the file, not only at the patch.',
        'You will need to repair the syntax by hand, or undo the change.',
      ],
    };
  }

  const counts = classify(proposal);

  // Type errors: the program is wrong in a way a compiler can prove.
  if (counts.type > 0) {
    return {
      verified: false,
      level: 'high',
      headline:
        counts.type === 1
          ? 'The patch introduces a type error'
          : `The patch introduces ${String(counts.type)} type errors`,
      detail: gate.diagnostic ?? gate.explanation,
      consequences: [
        'The type-checker will fail on this file, so a typed build or CI step will not pass.',
        'The error may be real — a value used in a way the code around it does not support.',
        'If your project builds with type checking, this change will block that build.',
      ],
    };
  }

  // Semantic findings from a non-lint, non-type analyzer (semgrep, go-vet, complexity).
  if (counts.other > 0) {
    return {
      verified: false,
      level: 'medium',
      headline: `The patch introduces ${String(counts.other)} new problem(s)`,
      detail: gate.diagnostic ?? gate.explanation,
      consequences: [
        'An analyzer that was clean on this file now reports a problem the patch introduced.',
        'These findings can include security and correctness rules, not only style.',
        'The original problem may be fixed, but the file is in a worse state than before overall.',
      ],
    };
  }

  // Lint only: the least severe class, and the one where forcing is most often reasonable.
  if (counts.lint > 0) {
    return {
      verified: false,
      level: 'low',
      headline:
        counts.lint === 1
          ? 'The patch introduces one lint warning'
          : `The patch introduces ${String(counts.lint)} lint warnings`,
      detail: gate.diagnostic ?? gate.explanation,
      consequences: [
        'The code parses and type-checks — this is a style or idiom rule, not a correctness failure.',
        'A lint step in your build or CI may fail until the rule is satisfied.',
        'If your project does not enforce these rules, applying this is usually harmless.',
      ],
    };
  }

  // A regression with no itemised findings. Rare, and deliberately not softened.
  return {
    verified: false,
    level: 'medium',
    headline: 'The patch failed verification',
    detail: gate.diagnostic ?? gate.explanation,
    consequences: [
      'Verification reported the file is worse after the patch than before it.',
      'The specific findings were not itemised, so the change cannot be assessed line by line.',
    ],
  };
}
