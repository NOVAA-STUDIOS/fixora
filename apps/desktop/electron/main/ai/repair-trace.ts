import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Finding, RepairMode, VerificationReport } from '@fixora/shared-types';
import { app } from 'electron';

/**
 * Full-pipeline diagnostics for a repair attempt (Manual Validation Phase 2).
 *
 * Written because "the repair does not parse" is a verdict, not an explanation: it says the patched
 * file was rejected, but not which stage produced something wrong. The stages each transform the
 * repair, and any one of them could be the corrupting step:
 *
 *     finding → target resolution → prompt → raw model reply → parsed object → splice → parser
 *
 * So every stage is recorded verbatim, in order, and a failed attempt is dumped to one JSON file that
 * can be attached to a bug report. This does NOT change any behaviour — it only observes.
 *
 * ## Privacy
 *
 * A trace necessarily contains source code, so it is written ONLY to the user's own machine, only on
 * failure, and never transmitted anywhere. It records no provider key: the request is captured after
 * the key has been left behind in the transport layer, and the key is never part of the prompt.
 */

export interface RepairTrace {
  at: string;
  requestId: string;
  mode: RepairMode;
  language: string | null;
  /** The finding the user selected, in full — including whether it carried a repair scope. */
  finding: {
    id: string;
    ruleId: string;
    source: string;
    severity: string;
    message: string;
    location: Finding['location'];
    repair: string;
    /**
     * The two fields that decide the repair target. Recorded explicitly because their ABSENCE is
     * itself a finding: with neither, the target collapses to the finding's own single line.
     */
    hasEnclosingRange: boolean;
    hasEnclosingSymbol: boolean;
  };
  /** The resolved splice range, and the exact text the model was asked to replace. */
  target: {
    startLine: number;
    endLine: number;
    symbolName: string | null;
    lineCount: number;
    text: string;
  };
  relatedFindings: { ruleId: string; line: number; message: string }[];
  /** The whole file as it was read, so the trace is self-contained and replayable. */
  originalFile: string;
  prompt: string;
  rawResponse: string;
  parsed: {
    ok: boolean;
    repairedCode?: string;
    rationale?: string;
    confidence?: number;
    reason?: string;
    detail?: string;
  };
  /** The file after splicing — the exact bytes the parser judged. */
  splicedFile: string | null;
  parser: { syntaxOk: boolean; error?: unknown } | null;
  verifier: {
    verdict: VerificationReport['verdict'];
    note?: string;
    newFindingCount: number;
  } | null;
  regression: { newFindings: unknown[] } | null;
}

/** A stage-by-stage recorder. Fields are filled as the pipeline advances; unset ones stay absent. */
export class RepairTraceBuilder {
  private readonly trace: Partial<RepairTrace> = {};

  constructor(requestId: string, mode: RepairMode) {
    this.trace.at = new Date().toISOString();
    this.trace.requestId = requestId;
    this.trace.mode = mode;
  }

  finding(finding: Finding, language: string | null): this {
    this.trace.language = language;
    this.trace.finding = {
      id: finding.id,
      ruleId: finding.ruleId,
      source: finding.source,
      severity: finding.severity,
      message: finding.message,
      location: finding.location,
      repair: finding.repair,
      hasEnclosingRange: finding.evidence.enclosingRange !== undefined,
      hasEnclosingSymbol: finding.evidence.enclosingSymbol !== undefined,
    };
    return this;
  }

  target(
    range: { startLine: number; endLine: number; symbolName: string | null },
    originalFile: string,
  ): this {
    const text = originalFile
      .split(/\r?\n/)
      .slice(range.startLine - 1, range.endLine)
      .join('\n');
    this.trace.originalFile = originalFile;
    this.trace.target = {
      ...range,
      lineCount: range.endLine - range.startLine + 1,
      text,
    };
    return this;
  }

  related(findings: readonly Finding[]): this {
    this.trace.relatedFindings = findings.map((f) => ({
      ruleId: f.ruleId,
      line: f.location.startLine,
      message: f.message,
    }));
    return this;
  }

  prompt(prompt: string): this {
    this.trace.prompt = prompt;
    return this;
  }

  rawResponse(text: string): this {
    this.trace.rawResponse = text;
    return this;
  }

  parsed(parsed: RepairTrace['parsed']): this {
    this.trace.parsed = parsed;
    return this;
  }

  spliced(splicedFile: string): this {
    this.trace.splicedFile = splicedFile;
    return this;
  }

  verified(report: VerificationReport): this {
    this.trace.parser = {
      syntaxOk: report.syntaxOk,
      ...(report.syntaxError !== undefined ? { error: report.syntaxError } : {}),
    };
    this.trace.verifier = {
      verdict: report.verdict,
      ...(report.note !== undefined ? { note: report.note } : {}),
      newFindingCount: report.newFindingCount,
    };
    this.trace.regression = { newFindings: [...(report.newFindings ?? [])] };
    return this;
  }

  /**
   * Write the trace, returning its path. Called only when an attempt fails verification — a trace per
   * successful repair would be a stream of source code onto disk for no diagnostic benefit.
   */
  write(): string | null {
    try {
      const dir = join(app.getPath('userData'), 'repair-traces');
      mkdirSync(dir, { recursive: true });
      const path = join(
        dir,
        `repair-${String(Date.now())}-${this.trace.requestId ?? 'unknown'}.json`,
      );
      writeFileSync(path, JSON.stringify(this.trace, null, 2), 'utf8');
      return path;
    } catch {
      // Diagnostics must never be able to fail a repair. A trace we could not write is a trace we
      // do not have, not an error the user should see.
      return null;
    }
  }

  /** The stage summary for the console log — no source code, safe to read at a glance. */
  summary(): Record<string, unknown> {
    return {
      mode: this.trace.mode,
      language: this.trace.language,
      ruleId: this.trace.finding?.ruleId,
      findingLine: this.trace.finding?.location.startLine,
      hasEnclosingRange: this.trace.finding?.hasEnclosingRange,
      hasEnclosingSymbol: this.trace.finding?.hasEnclosingSymbol,
      targetLines: this.trace.target
        ? `${String(this.trace.target.startLine)}-${String(this.trace.target.endLine)}`
        : null,
      targetLineCount: this.trace.target?.lineCount,
      relatedCount: this.trace.relatedFindings?.length ?? 0,
      rawResponseChars: this.trace.rawResponse?.length ?? 0,
      parsedOk: this.trace.parsed?.ok,
      syntaxOk: this.trace.parser?.syntaxOk,
      verdict: this.trace.verifier?.verdict,
      newFindingCount: this.trace.verifier?.newFindingCount,
    };
  }
}
