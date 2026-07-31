import type { Finding, VerificationReport, Verdict } from '@fixora/shared-types';

/**
 * Pure verification logic (ADR-003): splice a repair into a file, and turn two sets of findings into a
 * verdict. Kept free of fs and the worker so the decision that earns the user's trust is unit-testable
 * and deterministic — the same inputs always produce the same verdict.
 */

/**
 * The file's dominant line ending. A repair spliced into a CRLF (Windows) file must not leave LF-only
 * lines behind it — that mixes endings and shows up as a whole-file diff / git warning, corrupting the
 * source in the eyes of every tool that cares. CRLF wins when at least half the newlines are CRLF, so
 * a consistently-CRLF file stays CRLF and a consistently-LF file stays LF.
 */
export function dominantEol(content: string): '\r\n' | '\n' {
  const total = (content.match(/\n/g) ?? []).length;
  const crlf = (content.match(/\r\n/g) ?? []).length;
  return total > 0 && crlf * 2 >= total ? '\r\n' : '\n';
}

/** The leading whitespace of the first non-blank line — the block's base indentation. */
function baseIndent(text: string): string | null {
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === '') continue;
    return /^[\t ]*/.exec(line)?.[0] ?? '';
  }
  return null;
}

/**
 * Re-base a replacement block's indentation onto the original's.
 *
 * Models routinely dedent: asked to return "the corrected code" for a target that begins at column 4,
 * they reply flush left. Splicing that verbatim wrote real damage into users' files — observed during
 * validation, where an applied repair turned `    const [x] = useState(0);` into an unindented line,
 * and a JSON member lost its two spaces. In Python that is not cosmetic at all; it changes what the
 * code means.
 *
 * The shift is uniform, so *relative* indentation inside the replacement is preserved exactly — only
 * the block's alignment to its surroundings is corrected. This is deliberately conservative:
 *
 *  - blank lines are never given trailing indentation;
 *  - when the two indents are not prefix-compatible (spaces vs tabs), nothing is changed, because
 *    guessing the author's whitespace convention is how you corrupt a file rather than fix one;
 *  - when the model already matched the original indent, this is a no-op.
 *
 * It cannot alter semantics beyond alignment: no non-whitespace character is touched, and a repair
 * that legitimately restructures nesting keeps its internal shape.
 */
export function reindentToMatch(original: string, replacement: string): string {
  const target = baseIndent(original);
  const actual = baseIndent(replacement);
  if (target === null || actual === null || target === actual) return replacement;

  const shift = (line: string, apply: (l: string) => string): string =>
    line.trim() === '' ? line : apply(line);

  // The model dedented (the common case): put the missing prefix back on every line.
  if (actual === '' || target.startsWith(actual)) {
    const add = target.slice(actual.length);
    return replacement
      .split(/\r?\n/)
      .map((line) => shift(line, (l) => add + l))
      .join('\n');
  }
  // The model over-indented: remove the excess, but only if every line actually carries it.
  if (actual.startsWith(target)) {
    const excess = actual.slice(target.length);
    const lines = replacement.split(/\r?\n/);
    if (lines.every((l) => l.trim() === '' || l.startsWith(excess))) {
      return lines.map((line) => shift(line, (l) => l.slice(excess.length))).join('\n');
    }
  }
  // Incompatible whitespace conventions — leave it exactly as the model wrote it.
  return replacement;
}

/**
 * Replace a 1-based inclusive line range with `replacement`, returning the new file content.
 *
 * Two normalisations happen here, and both must happen HERE rather than at the call sites, because
 * this function is the single point both verification and apply go through. Anything done to the
 * patch in one place and not the other would mean the bytes that were verified are not the bytes that
 * get written — the one property the whole verification story depends on.
 *
 *  - **Line endings** are normalised to the file's dominant ending, so a model reply (always LF)
 *    spliced into a CRLF file produces a uniformly-CRLF result, never a mixed-ending file.
 *  - **Indentation** is re-based onto the original block's, so a dedented reply does not silently
 *    strip the leading whitespace of the code it replaces.
 */
export function spliceLines(
  content: string,
  startLine: number,
  endLine: number,
  replacement: string,
): string {
  const eol = dominantEol(content);
  const lines = content.split(/\r?\n/);
  const before = lines.slice(0, Math.max(0, startLine - 1));
  const after = lines.slice(endLine);
  const original = lines.slice(Math.max(0, startLine - 1), endLine).join('\n');
  const aligned = reindentToMatch(original, replacement);
  return [...before, ...aligned.split(/\r?\n/), ...after].join(eol);
}

/**
 * Find where an exact target block moved to, when it is no longer at its recorded line range.
 *
 * Deliberately EXACT, never fuzzy. A small edit elsewhere in the file (an import added above, a
 * blank line removed) shifts every line number below it without changing the target text itself —
 * the repair is still valid, just stale on line numbers. Since the located text is byte-identical to
 * what verification ran against, relocating it and splicing carries no more risk than the original
 * apply: nothing unverified is ever written.
 *
 * Returns the match nearest `nearLine` (by start-of-block distance) when the block appears more than
 * once, since the same snippet can legitimately repeat in a file and the closest occurrence is the
 * one that actually moved rather than a coincidental duplicate elsewhere.
 */
export function locateRange(
  content: string,
  expected: string,
  nearLine: number,
): { startLine: number; endLine: number } | null {
  if (expected.trim() === '') return null;
  const lines = content.split(/\r?\n/);
  const expectedLines = expected.split(/\r?\n/);
  const span = expectedLines.length;

  let best: { startLine: number; endLine: number } | null = null;
  let bestDistance = Infinity;

  for (let i = 0; i + span <= lines.length; i += 1) {
    let matches = true;
    for (let j = 0; j < span; j += 1) {
      if (lines[i + j] !== expectedLines[j]) {
        matches = false;
        break;
      }
    }
    if (!matches) continue;
    const startLine = i + 1;
    const distance = Math.abs(startLine - nearLine);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = { startLine, endLine: i + span };
    }
  }
  return best;
}

/**
 * Extract a 1-based inclusive line range (the original target text). Line endings are stripped (split
 * on `/\r?\n/`, join on `\n`) so the stale-range comparison is on content, not on whether the file
 * happens to use CRLF — the same text must compare equal regardless of ending.
 */
export function sliceLines(content: string, startLine: number, endLine: number): string {
  return content
    .split(/\r?\n/)
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
  /**
   * The finding being repaired. `null` is EDIT MODE (Proceed, P2.1): there is no finding to resolve,
   * so the verdict reduces to "does it parse and introduce no new problems". The repair path always
   * passes a Finding and is byte-for-byte unchanged — every branch that reads `target` is guarded.
   */
  target: Finding | null;
  originalFindings: readonly Finding[];
  patchedFindings: readonly Finding[];
  syntaxOk: boolean;
}

export function computeVerdict(input: VerdictInput): VerificationReport {
  const targetSig = input.target === null ? null : verificationSignature(input.target);
  const originalSigs = new Set(input.originalFindings.map(verificationSignature));
  const patchedSigs = input.patchedFindings.map(verificationSignature);
  const patchedSet = new Set(patchedSigs);

  // In edit mode there is no target to resolve, so "resolved" is vacuously true.
  const targetResolved = targetSig === null ? true : !patchedSet.has(targetSig);
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
    note =
      input.target === null
        ? `The edit introduces ${String(newFindingCount)} new problem(s).`
        : `The fix resolves the finding but introduces ${String(newFindingCount)} new problem(s).`;
  } else if (targetResolved) {
    verdict = 'verified';
  } else {
    verdict = 'unresolved';
    note = 'The fix did not resolve the finding.';
  }

  // The evidence behind the verdict. A `regression` is a claim about signature-set arithmetic, and
  // without the sets themselves that claim is unfalsifiable by the person it affects most.
  const diagnostics = {
    targetSignature: targetSig ?? '(edit — no target finding)',
    originalSignatures: [...originalSigs].sort(),
    patchedSignatures: [...patchedSet].sort(),
    newSignatures: [...newSigs].sort(),
    // Recorded so it is visible that severity is *carried* but never *consulted*: no branch in this
    // function reads it. If a regression report ever correlates with severity, this is the proof it
    // did not come from here.
    targetSeverity: input.target?.severity ?? 'n/a',
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
