import type { AiProposal, ApplyOutcome, ApplyRepairRequest, Finding } from '@fixora/shared-types';

/**
 * Why Apply is or is not enabled, as one explicit answer.
 *
 * The rule lived as a bare `disabled={report.verdict === 'regression'}` in JSX, which is correct
 * but unreadable: when a user reports "Apply is disabled and I don't know why", nothing in the UI
 * or the logs could answer them. Stating the rule as a value makes it inspectable, testable, and
 * displayable — and makes it obvious that the finding's severity is not one of the inputs.
 */
export type ApplyGate =
  | { enabled: true; reason: 'verified'; explanation: string }
  | { enabled: true; reason: 'unresolved'; explanation: string }
  | { enabled: true; reason: 'skipped'; explanation: string }
  | { enabled: false; reason: 'regression'; explanation: string }
  | { enabled: false; reason: 'no-proposal'; explanation: string }
  | { enabled: false; reason: 'empty-patch'; explanation: string };

export function evaluateApplyGate(
  proposal: Extract<AiProposal, { profile: 'repair' }> | null,
): ApplyGate {
  if (proposal === null) {
    return {
      enabled: false,
      reason: 'no-proposal',
      explanation: 'There is no repair proposal to apply.',
    };
  }
  if (proposal.repairedCode.length === 0) {
    return {
      enabled: false,
      reason: 'empty-patch',
      explanation: 'The model returned an empty replacement, so there is nothing to write.',
    };
  }

  // The ONLY disabling condition. Severity is deliberately absent: whether a patch is safe to apply
  // is a property of the patch, not of how loudly the original problem was reported.
  switch (proposal.verification.verdict) {
    case 'regression':
      return {
        enabled: false,
        reason: 'regression',
        explanation: !proposal.verification.syntaxOk
          ? 'The patched file does not parse, so applying it would break the file.'
          : `The patch introduces ${String(proposal.verification.newFindingCount)} problem(s) the file did not have before.`,
      };
    case 'verified':
      return {
        enabled: true,
        reason: 'verified',
        explanation: 'The analyzers re-ran against this change and found no new problems.',
      };
    case 'unresolved':
      return {
        enabled: true,
        reason: 'unresolved',
        explanation:
          'The patch breaks nothing, but the original finding is still reported. Applying it is allowed — it is your call whether it helps.',
      };
    case 'skipped':
      return {
        enabled: true,
        reason: 'skipped',
        explanation:
          'Verification could not run for this file, so this patch is unverified. Applying it is allowed but unchecked.',
      };
  }
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
      case 'regression':
        return {
          kind: 'show-verification',
          label: 'See what broke',
          reason: 'This repair would introduce a new problem.',
          detail: gate.explanation,
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
