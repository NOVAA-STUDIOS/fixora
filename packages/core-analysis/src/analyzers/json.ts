import type { Finding } from '@fixora/shared-types';

import type { Analyzer } from '../analyzer.js';
import { findingId } from '../finding-id.js';
import { classifyRepair } from '../repair/micro-repair.js';

/**
 * The JSON validator (ADR-025 Tier B). JSON has no linter and no symbols; its one meaningful defect is
 * *invalidity* — a trailing comma, an unquoted key, a missing brace — and the authoritative judge of
 * that is the JSON grammar itself, i.e. `JSON.parse`. So this analyzer is deterministic and needs no
 * external tool: it parses, and on failure reports exactly one finding at the position the parser
 * rejected, which is where a human would look first.
 *
 * It reports the FIRST error only, because that is all `JSON.parse` knows — and a JSON file with one
 * structural error usually has exactly one cause. Over-reporting speculative follow-on errors from a
 * recovering parser is the kind of noise that makes a validator untrustworthy.
 */

const RULE_ID = 'json-parse';

/** Turn a 0-based character offset into a 1-based line/column against the source. */
function offsetToLineCol(source: string, offset: number): { line: number; column: number } {
  let line = 1;
  let lineStart = 0;
  for (let i = 0; i < offset && i < source.length; i++) {
    if (source[i] === '\n') {
      line += 1;
      lineStart = i + 1;
    }
  }
  return { line, column: offset - lineStart + 1 };
}

/**
 * Pull a location out of a `JSON.parse` SyntaxError. Node's message has varied across versions, so
 * both known forms are handled: an explicit "(line L column C)" when present, otherwise "position N"
 * converted against the source. Falls back to line 1 if neither is found — a finding at the top of the
 * file is still better than none, and still says "this file is not valid JSON".
 */
function locate(message: string, source: string): { line: number; column: number } {
  const lineCol = /line (\d+) column (\d+)/i.exec(message);
  if (lineCol?.[1] !== undefined && lineCol[2] !== undefined) {
    return { line: Number(lineCol[1]), column: Number(lineCol[2]) };
  }
  const pos = /position (\d+)/i.exec(message);
  if (pos?.[1] !== undefined) return offsetToLineCol(source, Number(pos[1]));
  return { line: 1, column: 1 };
}

export function createJsonAnalyzer(): Analyzer {
  return {
    id: 'json',

    // No external tool and no capability gate: a JSON file can always be checked for validity.
    supports() {
      return true;
    },

    // eslint-disable-next-line @typescript-eslint/require-await -- async to satisfy the Analyzer contract
    async *run(context, signal): AsyncIterable<Finding> {
      for (const file of context.files) {
        if (signal.aborted) return;
        if (file.language !== 'json') continue;
        const source = context.readSource(file.absPath);
        if (source === null) continue;

        try {
          JSON.parse(source);
          continue; // valid JSON — nothing to report
        } catch (error) {
          const raw = error instanceof Error ? error.message : String(error);
          const { line, column } = locate(raw, source);
          // Strip Node's "in JSON at position ..." tail so the message reads as the defect, not the
          // parser's bookkeeping.
          const message = raw.replace(/\s+in JSON at position.*$/i, '').trim();
          const snippet = source.split(/\r?\n/)[line - 1] ?? '';

          const finding: Finding = {
            id: findingId({ source: 'json', ruleId: RULE_ID, file: file.file, snippet }),
            source: 'json',
            ruleId: RULE_ID,
            severity: 'error',
            category: 'correctness',
            location: {
              file: file.file,
              startLine: line,
              startCol: column,
              endLine: line,
              endCol: column,
            },
            message: `Invalid JSON: ${message}.`,
            evidence: { snippet, relatedLocations: [], toolOutput: { raw } },
            fixable: false,
            repair: 'ai-required',
            confidence: 1,
          };
          finding.repair = classifyRepair(finding);
          yield finding;
        }
      }
    },
  };
}
