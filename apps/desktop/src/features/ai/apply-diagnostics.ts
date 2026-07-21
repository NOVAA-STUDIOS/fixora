import type { AiProposal, ApplyOutcome, ApplyRepairRequest, Finding } from '@fixora/shared-types';

/**
 * Why Apply is or is not enabled, as one explicit answer.
 *
 * The rule lived as a bare `disabled={report.verdict === 'regression'}` in JSX, which is correct
 * but unreadable: when a user reports "Apply is disabled and I don't know why", nothing in the UI
 * or the logs could answer them. Stating the rule as a value makes it inspectable, testable, and
 * displayable — and makes it obvious that the finding's severity is not one of the inputs.
 */
/** The three quality gates, evaluated in this order (Goals 4 & 9). */
export type GateName = 'parser' | 'verifier' | 'formatter';

export interface GateOutcome {
  name: GateName;
  /** `pass` cleared it, `fail` blocks Apply, `not-run` means the gate could not or need not run. */
  status: 'pass' | 'fail' | 'not-run';
  /** One human sentence: the exact reason, never a generic placeholder. */
  detail: string;
}

export type ApplyGate =
  | {
      enabled: true;
      reason: 'verified' | 'unresolved' | 'skipped';
      explanation: string;
      gates: GateOutcome[];
    }
  | {
      enabled: false;
      reason: 'no-proposal' | 'empty-patch' | 'parser' | 'verifier' | 'formatter';
      explanation: string;
      /** The precise machine diagnostic behind the failure (parser/compiler/formatter message). */
      diagnostic?: string;
      gates: GateOutcome[];
    };

type Report = Extract<AiProposal, { profile: 'repair' }>['verification'];

/** How many of the new findings came from the type-checker — lets the UI say "TypeScript diagnostics". */
function tscCount(report: Report): number {
  return (report.newFindings ?? []).filter((f) => f.source === 'tsc').length;
}

/**
 * Evaluate the Parser → Verifier → Formatter gates and decide Apply. The FIRST failing gate, in that
 * order, is the one reported: a file that does not parse cannot meaningfully be verified or formatted,
 * so its parser failure is the honest headline. Every branch names the exact gate and carries the
 * precise diagnostic — there is no path that returns a generic "cannot apply".
 */
export function evaluateApplyGate(
  proposal: Extract<AiProposal, { profile: 'repair' }> | null,
): ApplyGate {
  if (proposal === null) {
    return {
      enabled: false,
      reason: 'no-proposal',
      explanation: 'There is no repair proposal to apply.',
      gates: [],
    };
  }
  if (proposal.repairedCode.length === 0) {
    return {
      enabled: false,
      reason: 'empty-patch',
      explanation: 'The model returned an empty replacement, so there is nothing to write.',
      gates: [],
    };
  }

  const v = proposal.verification;
  const skipped = v.verdict === 'skipped';

  // Gate 1 — PARSER.
  const parser: GateOutcome = {
    name: 'parser',
    status: v.syntaxOk ? 'pass' : 'fail',
    detail: v.syntaxOk
      ? 'The patched file parses.'
      : v.syntaxError
        ? `Parser failed at line ${String(v.syntaxError.line)}: ${v.syntaxError.text}`
        : 'The patched file does not parse.',
  };

  // Gate 2 — VERIFIER (analyzers + type-checker re-run). Not run if the file does not parse, or if
  // verification was skipped. Fails only on a genuine regression (a NEW problem), never on an
  // unresolved-but-harmless patch.
  const verifier: GateOutcome = !v.syntaxOk
    ? { name: 'verifier', status: 'not-run', detail: 'Not run — the file does not parse.' }
    : skipped
      ? {
          name: 'verifier',
          status: 'not-run',
          detail: v.note ?? 'Verification could not run for this file.',
        }
      : v.verdict === 'regression'
        ? { name: 'verifier', status: 'fail', detail: verifierDetail(v) }
        : {
            name: 'verifier',
            status: 'pass',
            detail: v.targetResolved
              ? 'The analyzers and type-checker re-ran and found no new problems.'
              : 'The patch introduces no new problems (the original finding still stands).',
          };

  // Gate 3 — FORMATTER.
  const fmt = v.formatter;
  const formatter: GateOutcome =
    !fmt?.ran
      ? {
          name: 'formatter',
          status: 'not-run',
          detail: 'No formatter is configured for this language.',
        }
      : fmt.ok
        ? {
            name: 'formatter',
            status: 'pass',
            detail: `${fmt.formatter ?? 'The formatter'} accepted the patched file.`,
          }
        : {
            name: 'formatter',
            status: 'fail',
            detail: `${fmt.formatter ?? 'Formatter'} could not format the patched file.`,
          };

  const gates = [parser, verifier, formatter];

  // First failing gate, in order, is the headline.
  if (parser.status === 'fail') {
    return {
      enabled: false,
      reason: 'parser',
      explanation: `Parser failed. ${parser.detail}`,
      ...(v.syntaxError !== undefined ? { diagnostic: v.syntaxError.text } : {}),
      gates,
    };
  }
  if (verifier.status === 'fail') {
    return {
      enabled: false,
      reason: 'verifier',
      explanation: `${tscCount(v) > 0 ? 'TypeScript diagnostics failed' : 'Verification failed'}. ${verifier.detail}`,
      diagnostic: verifierDetail(v),
      gates,
    };
  }
  if (formatter.status === 'fail') {
    return {
      enabled: false,
      reason: 'formatter',
      explanation: `Formatter failed. ${formatter.detail}`,
      ...(fmt?.message !== undefined ? { diagnostic: fmt.message } : {}),
      gates,
    };
  }

  // All gates cleared (or honestly did not run).
  if (skipped) {
    return {
      enabled: true,
      reason: 'skipped',
      explanation:
        'Verification could not run for this file, so this patch is unverified. Applying it is allowed but unchecked.',
      gates,
    };
  }
  if (v.verdict === 'unresolved') {
    return {
      enabled: true,
      reason: 'unresolved',
      explanation:
        'The patch breaks nothing, but the original finding is still reported. Applying it is allowed — it is your call whether it helps.',
      gates,
    };
  }
  return {
    enabled: true,
    reason: 'verified',
    explanation:
      'Parser, verifier and formatter all passed. The analyzers re-ran against this change and found no new problems.',
    gates,
  };
}

/** The verifier gate's detail: the new findings, with locations, that make this a regression. */
function verifierDetail(report: Report): string {
  const news = report.newFindings ?? [];
  if (news.length === 0) {
    return `The patch introduces ${String(report.newFindingCount)} problem(s) the file did not have before.`;
  }
  const shown = news
    .slice(0, 3)
    .map((f) => `${f.ruleId} at line ${String(f.line)}: ${f.message}`)
    .join('; ');
  const more = news.length > 3 ? ` (+${String(news.length - 3)} more)` : '';
  return `The patch introduces ${String(news.length)} new problem(s): ${shown}${more}`;
}

/** One apply attempt, start to finish, as a record the UI can render and the console can print. */
export type ApplyAttempt = {
  at: number;
  findingSeverity: Finding['severity'] | 'unknown';
  findingId: string | null;
  gate: ApplyGate;
  request: ApplyRepairRequest;
  /** null while in flight; the transport error message when the IPC itself failed. */
  response: ApplyOutcome | null;
  transportError: string | null;
  durationMs: number | null;
};

/**
 * The single sentence that answers "why did this fail?".
 *
 * Three failure classes are easy to confuse from the outside — the button was disabled, the IPC
 * never landed, or main refused the write — and they have completely different fixes. This names
 * which one happened.
 */
export function rootCauseOf(attempt: ApplyAttempt): string {
  if (!attempt.gate.enabled) {
    return `Blocked before sending: ${attempt.gate.reason} — ${attempt.gate.explanation}`;
  }
  if (attempt.transportError !== null) {
    return `IPC transport failed: ${attempt.transportError}`;
  }
  if (attempt.response === null) {
    return 'No response received (still in flight, or the handler never returned).';
  }
  if (attempt.response.applied) {
    return 'Applied successfully.';
  }
  return `Refused by main: ${attempt.response.reason} — ${attempt.response.message}`;
}

/**
 * What a user should DO about a failure, and what to call the button that does it.
 *
 * Every failure state gets one, because a reason without a remedy is just bad news. The `kind`
 * drives the button the banner renders; `explanation` is the sentence above it. Deliberately
 * written for someone who did not write the app: "stale-range" is a code, not an explanation.
 */
export type RemedyKind = 'retry-repair' | 'refresh-editor' | 'show-verification' | 'dismiss';

export type Remedy = {
  kind: RemedyKind;
  /** The button label. A verb, naming what happens. */
  label: string;
  /** One sentence, plain English, no internal vocabulary. */
  reason: string;
  /** The follow-up sentence: why this happened, or what the button will do. */
  detail: string;
};

/** The failure classes a user can actually be in, collapsed from gate + transport + main. */
export function remedyFor(attempt: ApplyAttempt | null, gate: ApplyGate): Remedy | null {
  // Gate refusals: the patch itself is the problem, so the answer is always a new patch.
  if (!gate.enabled) {
    switch (gate.reason) {
      case 'parser':
        return {
          kind: 'retry-repair',
          label: 'Generate new repair',
          reason: 'The repair does not parse.',
          detail: `${gate.explanation} A fresh repair usually produces valid code.`,
        };
      case 'verifier':
        return {
          kind: 'show-verification',
          label: 'See what broke',
          reason: 'This repair would introduce a new problem.',
          detail: gate.explanation,
        };
      case 'formatter':
        return {
          kind: 'retry-repair',
          label: 'Generate new repair',
          reason: 'The project formatter rejected the repair.',
          detail: `${gate.explanation} Re-running the repair usually resolves it.`,
        };
      case 'empty-patch':
        return {
          kind: 'retry-repair',
          label: 'Generate new repair',
          reason: 'The model returned an empty repair.',
          detail:
            'There is nothing to write to the file. Generating a new repair usually resolves it.',
        };
      case 'no-proposal':
        return {
          kind: 'dismiss',
          label: 'Close',
          reason: 'There is no repair to apply.',
          detail: 'Pick a finding in Problems and run Repair to generate one.',
        };
    }
  }

  if (attempt === null) return null;

  if (attempt.transportError !== null) {
    return {
      kind: 'retry-repair',
      label: 'Try again',
      reason: 'Fixora could not complete the apply.',
      detail: `The request to the app's main process failed: ${attempt.transportError}`,
    };
  }

  const response = attempt.response;
  if (response === null || response.applied) return null;

  switch (response.reason) {
    case 'stale-range':
      return {
        kind: 'retry-repair',
        label: 'Run repair again',
        reason: 'The file has changed since this repair was generated.',
        detail:
          'Applying it now would overwrite edits that are not in this preview. Running the repair again rebuilds it against the current file.',
      };
    case 'range-out-of-bounds':
      return {
        kind: 'refresh-editor',
        label: 'Reload file',
        reason: 'This repair points at lines that no longer exist.',
        detail:
          'The file is shorter than it was when the repair was generated. Reloading it and running the repair again will target the right place.',
      };
    case 'no-workspace':
      return {
        kind: 'dismiss',
        label: 'Close',
        reason: 'No project is open.',
        detail: 'Open the project this repair belongs to, then run the repair again.',
      };
    case 'write-failed':
      return {
        kind: 'retry-repair',
        label: 'Try again',
        reason: 'Fixora could not write to the file.',
        detail:
          'The file may be read-only, open in another program, or outside the project. Check the file, then try again.',
      };
  }
}
