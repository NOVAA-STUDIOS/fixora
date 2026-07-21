import type { Finding } from '@fixora/shared-types';
import type { Node } from 'web-tree-sitter';

import type { Analyzer } from '../analyzer.js';
import { findingId } from '../finding-id.js';
import { parse } from '../parser/tree-sitter.js';
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
 * A location from a `JSON.parse` SyntaxError message, or null if the message carries none. Node's
 * message has two shapes: an explicit "(line L column C)" / "position N" (older and structured), and a
 * newer "Unexpected token …" form that gives only a context snippet and NO position. This handles the
 * first; the second is located by tree-sitter instead.
 */
function locateFromMessage(
  message: string,
  source: string,
): { line: number; column: number } | null {
  const lineCol = /line (\d+) column (\d+)/i.exec(message);
  if (lineCol?.[1] !== undefined && lineCol[2] !== undefined) {
    return { line: Number(lineCol[1]), column: Number(lineCol[2]) };
  }
  const pos = /position (\d+)/i.exec(message);
  if (pos?.[1] !== undefined) return offsetToLineCol(source, Number(pos[1]));
  return null;
}

/**
 * Locate the first structural error with tree-sitter's JSON grammar — the fallback when JSON.parse's
 * message gives no position. Returns the first ERROR/MISSING node as 1-based line/column, or null if
 * the grammar somehow found nothing (in which case the caller uses line 1).
 */
async function locateWithTreeSitter(
  source: string,
  filePath: string,
): Promise<{ line: number; column: number } | null> {
  const flag = (node: Node, name: 'isError' | 'isMissing'): boolean => {
    const v = node[name] as unknown;
    return typeof v === 'function' ? (v as () => boolean).call(node) : v === true;
  };
  try {
    const tree = await parse('json', source, filePath);
    try {
      const visit = (node: Node): { line: number; column: number } | null => {
        for (let i = 0; i < node.childCount; i++) {
          const child = node.child(i);
          if (child === null) continue;
          if (child.type === 'ERROR' || flag(child, 'isError') || flag(child, 'isMissing')) {
            return { line: child.startPosition.row + 1, column: child.startPosition.column + 1 };
          }
          if (child.hasError) {
            const deeper = visit(child);
            if (deeper !== null) return deeper;
          }
        }
        return null;
      };
      return visit(tree.root);
    } finally {
      tree.dispose();
    }
  } catch {
    return null;
  }
}

export function createJsonAnalyzer(): Analyzer {
  return {
    id: 'json',

    // No external tool and no capability gate: a JSON file can always be checked for validity.
    supports() {
      return true;
    },

    async *run(context, signal): AsyncIterable<Finding> {
      for (const file of context.files) {
        if (signal.aborted) return;
        if (file.language !== 'json') continue;
        const source = context.readSource(file.absPath);
        if (source === null) continue;

        let raw: string | null = null;
        try {
          JSON.parse(source);
        } catch (error) {
          raw = error instanceof Error ? error.message : String(error);
        }
        if (raw !== null) {
          // JSON.parse is the authority on validity; its message locates the error when it can, and
          // tree-sitter's JSON grammar locates it when the message only carries a context snippet.
          const located =
            locateFromMessage(raw, source) ?? (await locateWithTreeSitter(source, file.file));
          const { line, column } = located ?? { line: 1, column: 1 };
          // Strip Node's bookkeeping tails so the message reads as the defect: both the
          // "… in JSON at position N (line …)" form and the newer "…, \"<snippet>\" is not valid
          // JSON" form, which otherwise dumps a chunk of the file into the message.
          const message = raw
            .replace(/\s+in JSON at position.*$/i, '')
            .replace(/,\s*(?:\.\.\.)?".*?"\.{0,3}\s*is not valid JSON.*$/is, '')
            .replace(/\s+is not valid JSON.*$/i, '')
            .trim();
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
