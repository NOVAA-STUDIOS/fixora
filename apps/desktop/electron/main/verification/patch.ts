import type { Finding, VerificationReport, Verdict } from '@fixora/shared-types';

/**
 * Pure verification logic (ADR-003): splice a repair into a file, and turn two sets of findings into a
 * verdict. Kept free of fs and the worker so the decision that earns the user's trust is unit-testable
 * and deterministic — the same inputs always produce the same verdict.
 */

/** Replace a 1-based inclusive line range with `replacement`, returning the new file content. */
export function spliceLines(
  content: string,
  startLine: number,
  endLine: number,
  replacement: string,
): string {
  const lines = content.split('\n');
  const before = lines.slice(0, Math.max(0, startLine - 1));
  const after = lines.slice(endLine);
  return [...before, ...replacement.split('\n'), ...after].join('\n');
}

/** Extract a 1-based inclusive line range (the original target symbol text). */
export function sliceLines(content: string, startLine: number, endLine: number): string {
  return content
    .split('\n')
    .slice(Math.max(0, startLine - 1), endLine)
    .join('\n');
}

/**
 * A finding's identity for verification comparison. NOT the DB's snippet-sensitive id (which changes the
 * instant any code changes) — instead source + rule + the enclosing symbol (falling back to a line
 * bucket), so "the same problem" survives a fix that shifts lines, and a genuinely new problem stands out.
 */
export function verificationSignature(finding: Finding): string {
  const symbol =
    finding.evidence.enclosingSymbol?.name ?? `line:${String(finding.location.startLine)}`;
  return `${finding.source}:${finding.ruleId}:${symbol}`;
}

export interface VerdictInput {
  target: Finding;
  originalFindings: readonly Finding[];
  patchedFindings: readonly Finding[];
  syntaxOk: boolean;
}

export function computeVerdict(input: VerdictInput): VerificationReport {
  const targetSig = verificationSignature(input.target);
  const originalSigs = new Set(input.originalFindings.map(verificationSignature));
  const patchedSigs = input.patchedFindings.map(verificationSignature);
  const patchedSet = new Set(patchedSigs);

  const targetResolved = !patchedSet.has(targetSig);
  // A regression is a finding the patched file has that the original did not (excluding the target).
  const newSigs = new Set(patchedSigs.filter((s) => s !== targetSig && !originalSigs.has(s)));
  const newFindingCount = newSigs.size;

  // The actual findings behind those signatures, with locations — the evidence the verifier gate
  // shows the user ("TS2345 at line 12: ..."). Deduped by signature so the count and the list agree.
  const seenNew = new Set<string>();
  const newFindings = input.patchedFindings
    .filter((f) => {
      const sig = verificationSignature(f);
      if (sig === targetSig || originalSigs.has(sig) || seenNew.has(sig)) return false;
      seenNew.add(sig);
      return true;
    })
    .map((f) => ({
      source: f.source,
      ruleId: f.ruleId,
      line: f.location.startLine,
      message: f.message,
    }));

  const sources = new Set<string>(['syntax']);
  for (const f of [...input.originalFindings, ...input.patchedFindings]) sources.add(f.source);
  const ran = [...sources];

  let verdict: Verdict;
  let note: string | undefined;
  if (!input.syntaxOk) {
    verdict = 'regression';
    note = 'The fix does not parse — it would break the file.';
  } else if (newFindingCount > 0) {
    verdict = 'regression';
    note = `The fix resolves the finding but introduces ${String(newFindingCount)} new problem(s).`;
  } else if (targetResolved) {
    verdict = 'verified';
  } else {
    verdict = 'unresolved';
    note = 'The fix did not resolve the finding.';
  }

  // The evidence behind the verdict. A `regression` is a claim about signature-set arithmetic, and
  // without the sets themselves that claim is unfalsifiable by the person it affects most.
  const diagnostics = {
    targetSignature: targetSig,
    originalSignatures: [...originalSigs].sort(),
    patchedSignatures: [...patchedSet].sort(),
    newSignatures: [...newSigs].sort(),
    // Recorded so it is visible that severity is *carried* but never *consulted*: no branch in this
    // function reads it. If a regression report ever correlates with severity, this is the proof it
    // did not come from here.
    targetSeverity: input.target.severity,
    originalSources: [...new Set(input.originalFindings.map((f) => f.source))].sort(),
    patchedSources: [...new Set(input.patchedFindings.map((f) => f.source))].sort(),
  };

  return {
    verdict,
    targetResolved,
    newFindingCount,
    syntaxOk: input.syntaxOk,
    ...(newFindings.length > 0 ? { newFindings } : {}),
    ran,
    diagnostics,
    ...(note !== undefined ? { note } : {}),
  };
}
