import type { Language } from '@fixora/shared-types';

import { parse } from '../parser/tree-sitter.js';
import { extractSymbols } from '../symbols/symbols.js';

/**
 * Target scope detection for Proceed Mode (P2.1, objective 3).
 *
 * Given a file and the user's selection (a line or a line range), resolve the SMALLEST valid scope to
 * edit — the tightest declared symbol (function, method, class, component) that fully contains the
 * selection. This reuses the analyzer's own symbol extraction (`extractSymbols`) rather than a second
 * parser, so a "scope" here is exactly what the rest of the engine calls a symbol. If no symbol
 * contains the selection (top-level code, or a language whose blocks we do not yet extract, e.g. a CSS
 * rule), we fall back to the selected lines themselves — never the whole file, never the repository.
 */

export interface EditScope {
  readonly symbolName: string | null;
  readonly startLine: number;
  readonly endLine: number;
  readonly text: string;
  /**
   * How the scope was chosen — for logging and for the smallest-context guarantee.
   *  - `enclosing-symbol`  the selection sits inside a declared symbol (the normal case)
   *  - `nearest-symbol`    the selection was on blank/among-declarations space, snapped to the closest
   *                        symbol (a caret on an empty line is a normal cursor position, and a
   *                        one-blank-line scope is not something a model can meaningfully edit)
   *  - `selection-fallback` no symbols apply; exactly the selected lines
   */
  readonly basis: 'enclosing-symbol' | 'nearest-symbol' | 'selection-fallback';
}

/** Slice a 1-based inclusive line range out of file content. */
function sliceLines(content: string, startLine: number, endLine: number): string {
  const lines = content.split('\n');
  const from = Math.max(0, startLine - 1);
  const to = Math.min(lines.length, endLine);
  return lines.slice(from, to).join('\n');
}

export interface ResolveScopeInput {
  readonly source: string;
  readonly language: Language;
  readonly filePath: string;
  readonly selectionStartLine: number;
  /** Defaults to `selectionStartLine` (a caret, not a range). */
  readonly selectionEndLine?: number;
}

export async function resolveEditScope(input: ResolveScopeInput): Promise<EditScope> {
  const totalLines = input.source.split('\n').length;
  const selStart = Math.max(1, Math.min(input.selectionStartLine, totalLines));
  const selEnd = Math.max(selStart, Math.min(input.selectionEndLine ?? selStart, totalLines));

  let smallest: { name: string; startLine: number; endLine: number } | null = null;
  let nearest: { name: string; startLine: number; endLine: number } | null = null;
  try {
    const tree = await parse(input.language, input.source, input.filePath);
    try {
      const symbols = extractSymbols(tree, input.language, input.filePath);
      for (const s of symbols) {
        const { startLine, endLine } = s.location;
        // Must fully contain the selection to be a valid edit scope.
        if (startLine > selStart || endLine < selEnd) continue;
        if (smallest === null || endLine - startLine < smallest.endLine - smallest.startLine) {
          smallest = { name: s.name, startLine, endLine };
        }
      }
      // Nothing contains the selection (e.g. the caret is on a blank line between declarations).
      // Snap to the closest symbol by line distance so the edit has a real target to work on.
      if (smallest === null) {
        const distance = (s: { startLine: number; endLine: number }): number =>
          selStart < s.startLine ? s.startLine - selStart : selStart - s.endLine;
        for (const s of symbols) {
          const { startLine, endLine } = s.location;
          if (nearest === null || distance({ startLine, endLine }) < distance(nearest)) {
            nearest = { name: s.name, startLine, endLine };
          }
        }
      }
    } finally {
      tree.dispose();
    }
  } catch {
    smallest = null; // a parser failure falls back to the selection — never throws out of scope detection
    nearest = null;
  }

  if (smallest !== null) {
    return {
      symbolName: smallest.name,
      startLine: smallest.startLine,
      endLine: smallest.endLine,
      text: sliceLines(input.source, smallest.startLine, smallest.endLine),
      basis: 'enclosing-symbol',
    };
  }

  // Snap to the nearest symbol ONLY when the selection itself is blank — a caret parked on an empty
  // line is a normal cursor position, and a one-blank-line scope is not editable. A selection with
  // real content is respected exactly as given.
  const selectedText = sliceLines(input.source, selStart, selEnd);
  if (nearest !== null && selectedText.trim() === '') {
    return {
      symbolName: nearest.name,
      startLine: nearest.startLine,
      endLine: nearest.endLine,
      text: sliceLines(input.source, nearest.startLine, nearest.endLine),
      basis: 'nearest-symbol',
    };
  }

  // Fallback: exactly the selected lines. The smallest possible context, and never the whole file.
  return {
    symbolName: null,
    startLine: selStart,
    endLine: selEnd,
    text: sliceLines(input.source, selStart, selEnd),
    basis: 'selection-fallback',
  };
}
