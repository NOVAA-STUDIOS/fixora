import type { Finding, Language, Severity } from '@fixora/shared-types';
import type { Node } from 'web-tree-sitter';

import type { Analyzer } from '../analyzer.js';
import { findingId } from '../finding-id.js';
import { parse } from '../parser/tree-sitter.js';
import { outermostConstructContaining } from '../repair/balanced-scope.js';
import { classifyRepair } from '../repair/micro-repair.js';

/**
 * The CSS and HTML validators (ADR-025 Tier B), built on the one thing that is authoritative for both:
 * their own grammar.
 *
 * Neither language ships a linter or type checker in this stack, and neither has symbols worth
 * extracting. What they do have is a well-defined notion of *invalid* — an unclosed block, a missing
 * semicolon before a declaration the parser then can't read, a mis-nested tag — and tree-sitter's
 * grammars locate exactly that. So this analyzer is deterministic, needs no external tool, and always
 * applies, precisely like `createJsonAnalyzer` does for JSON.
 *
 * Both languages were previously absent from `Language` entirely: they were silently skipped by
 * analysis and then refused by Repair/Proceed as "unsupported file type". Every finding produced here
 * is `ai-required` (there is no tool-authored autofix to inherit), so it flows into the normal AI
 * repair path and is validated by the normal verification engine — which re-parses the patched file
 * with the same grammar used here, so a repair that does not parse is a `regression` and is refused.
 *
 * ## Why this reports more than one finding, unlike the JSON validator
 *
 * `JSON.parse` knows exactly one error and stops, so reporting one finding is all it *can* honestly
 * do. tree-sitter recovers, so it genuinely locates multiple independent error regions — two
 * unrelated unclosed rules in a stylesheet are two real defects, and collapsing them to one would
 * under-report. The cap below exists so a catastrophically broken file (a binary blob renamed `.css`)
 * produces a usable list instead of thousands of rows.
 */

/** Past this many syntax errors in one file, the file is broken rather than buggy — stop listing. */
const MAX_ERRORS_PER_FILE = 20;

const RULE_ID: Record<'css' | 'html', string> = {
  css: 'css-syntax',
  html: 'html-syntax',
};

/** A missed `;` between two declarations. Its own rule, because it carries a deterministic fix. */
const CSS_MISSING_SEMICOLON = 'css-missing-semicolon';

/**
 * Mask the contents of strings and `url(...)` so a colon inside them cannot be mistaken for a
 * property separator. `background: url(http://x)` and `grid-template-areas: "a: b"` each contain a
 * second colon that means nothing structurally; without masking both would be false positives.
 * Replaced with spaces rather than removed so every remaining index still matches the source.
 */
function maskLiterals(text: string): string {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const ch = text[i] ?? '';
    if (ch === '"' || ch === "'") {
      out += ' ';
      i += 1;
      while (i < text.length && text[i] !== ch) {
        out += text[i] === '\n' ? '\n' : ' ';
        i += 1;
      }
      if (i < text.length) {
        out += ' ';
        i += 1;
      }
      continue;
    }
    if (text.startsWith('url(', i)) {
      const close = text.indexOf(')', i);
      const end = close === -1 ? text.length : close + 1;
      for (let j = i; j < end; j++) out += text[j] === '\n' ? '\n' : ' ';
      i = end;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

/**
 * A missed semicolon, located deterministically — the one common CSS defect the grammar cannot see.
 *
 * Measured directly against tree-sitter's CSS grammar: `color: #333\n  background: white;` parses as
 * a SINGLE valid declaration (`hasError` is false) whose value list simply swallows the next
 * property. The browser drops that whole declaration, so it is a real defect with a silent parse —
 * exactly the case a grammar-only validator misses, and the repo's own `samples/broken-css` fixture.
 *
 * The signal is a declaration that spans lines and, once literals are masked, contains a second
 * colon: one declaration legitimately has exactly one. The fix is unambiguous — a `;` at the end of
 * the first line — so this is emitted as a deterministic `Autofix`, not left to a model.
 */
function findMissingSemicolon(
  declarationText: string,
  declarationStart: number,
): { offset: number; line: number; column: number } | null {
  const masked = maskLiterals(declarationText);
  const firstColon = masked.indexOf(':');
  if (firstColon === -1) return null;
  const secondColon = masked.indexOf(':', firstColon + 1);
  if (secondColon === -1) return null;

  // The `;` belongs at the end of the declaration's first line — after the first value, before the
  // property that was swallowed. Anything past a newline is the next declaration's business.
  const firstNewline = masked.indexOf('\n', firstColon);
  if (firstNewline === -1 || secondColon < firstNewline) return null;
  let end = firstNewline;
  while (end > 0 && /\s/.test(declarationText[end - 1] ?? '')) end -= 1;
  return {
    offset: declarationStart + end,
    line: 1,
    column: end,
  };
}

/** Walk every `declaration` node in a parsed stylesheet. */
function eachDeclaration(root: Node, visit: (node: Node) => void): void {
  const walk = (node: Node): void => {
    if (node.type === 'declaration') visit(node);
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child !== null) walk(child);
    }
  };
  walk(root);
}

const LABEL: Record<'css' | 'html', string> = {
  css: 'CSS',
  html: 'HTML',
};

/**
 * HTML's grammar is deliberately forgiving — browsers recover from unclosed tags, and so does the
 * grammar, which means a "MISSING end tag" is far more often sloppy-but-working markup than a real
 * defect. Reporting those as errors would flood a normal page with noise, so HTML syntax findings are
 * warnings. CSS is stricter: a genuine parse error there usually means the declaration is being
 * dropped by the browser, which is a real correctness problem.
 */
const SEVERITY: Record<'css' | 'html', Severity> = {
  css: 'error',
  html: 'warning',
};

/** A located syntax error: where it is, and whether the grammar wanted a token that was absent. */
interface SyntaxError {
  line: number;
  column: number;
  missing: boolean;
  /** The node type the grammar expected but did not find — present only for MISSING nodes. */
  expected: string;
  /** The outermost construct containing this error — the repair target (Root Cause A). */
  enclosing?: { startLine: number; endLine: number } | null;
}

/**
 * `isError`/`isMissing` are properties on current web-tree-sitter and were methods on older ones.
 * Reading either shape keeps this working across the versions in the tree without pinning behaviour
 * to whichever one happens to be installed (the same guard `json.ts` uses).
 */
function flag(node: Node, name: 'isError' | 'isMissing'): boolean {
  const value = node[name] as unknown;
  return typeof value === 'function' ? (value as () => boolean).call(node) : value === true;
}

/**
 * Collect the outermost error regions, depth-first in source order.
 *
 * Outermost, not every node: tree-sitter marks a whole subtree as containing an error, so descending
 * into an ERROR node yields its children as further "errors" — the same single defect reported many
 * times at finer and finer granularity. Once a node is itself an error we take it and stop, and only
 * recurse through nodes that merely *contain* one.
 */
/**
 * Tailwind CSS v4 at-rules that the `tree-sitter-css` grammar does not know.
 *
 * The grammar predates Tailwind v4 and has no notion of these, so it reports each one as a syntax
 * error — "Invalid CSS: this is not valid CSS syntax" — on a file that is perfectly valid Tailwind.
 * In a real Laravel/Tailwind app that is every `@source` line in `app.css`, which both buries the
 * genuine findings and offers Repair on code that is not broken.
 *
 * Only the directives whose SHAPE actually defeats the grammar are listed. An unrecognised at-rule
 * with an ordinary shape (`@definitelynotreal foo;`) already parses cleanly, so it needs no entry —
 * which is also why this list stays short as Tailwind grows: a new directive only belongs here if it
 * introduces syntax the CSS grammar cannot represent (an unquoted argument, a parenthesised
 * selector). `@theme`, `@utility` and `@apply` are deliberately ABSENT: they parse today, so
 * suppressing them would blind us to real errors inside them for no benefit.
 */
const TAILWIND_AT_RULES = new Set([
  'source',
  'plugin',
  'variant',
  'custom-variant',
  'reference',
  'config',
]);

/** The at-rule a line opens with, lowercased and without the `@` — or null if it opens with none. */
function atRuleOn(line: string): string | null {
  return /^\s*@([a-z][a-z-]*)/i.exec(line)?.[1]?.toLowerCase() ?? null;
}

/**
 * Whether a CSS source line opens with a Tailwind directive the grammar cannot read.
 *
 * Exported because the ANALYZER is not the only thing that parses CSS: the verification worker
 * re-parses the patched file to decide `syntaxOk`, and that gate has to reach the same conclusion
 * about the same bytes. While it did not, the two disagreed on every Tailwind file — analysis
 * reported it clean, verification reported "the patched file does not parse" — and Apply was refused
 * for repairs that were perfectly good.
 */
export function isTailwindDirectiveLine(line: string): boolean {
  const rule = atRuleOn(line);
  return rule !== null && TAILWIND_AT_RULES.has(rule);
}

/**
 * Drop the errors that are only there because the grammar cannot read a Tailwind directive.
 *
 * Keyed on the SOURCE LINE rather than the ERROR node's text, because the node is not a reliable
 * witness: for `@source '…';` tree-sitter reports a MISSING `;` carrying no text at all, and an
 * ERROR whose text is just `";"`. The line the parser choked on is the honest signal, and these
 * directives are single-line by construction.
 *
 * Deliberately narrow: an error on any line that does NOT open with one of these directives is
 * untouched, so a genuine defect inside a rule block is still reported exactly as before.
 */
function withoutTailwindNoise(errors: SyntaxError[], lines: readonly string[]): SyntaxError[] {
  return errors.filter((error) => {
    const rule = atRuleOn(lines[error.line - 1] ?? '');
    return rule === null || !TAILWIND_AT_RULES.has(rule);
  });
}

function collectErrors(root: Node, limit: number): SyntaxError[] {
  const errors: SyntaxError[] = [];
  const visit = (node: Node): void => {
    if (errors.length >= limit) return;
    for (let i = 0; i < node.childCount; i++) {
      if (errors.length >= limit) return;
      const child = node.child(i);
      if (child === null) continue;
      const isMissing = flag(child, 'isMissing');
      const isError = child.type === 'ERROR' || flag(child, 'isError');
      if (isError || isMissing) {
        errors.push({
          line: child.startPosition.row + 1,
          column: child.startPosition.column + 1,
          missing: isMissing,
          expected: isMissing ? child.type : '',
        });
        continue; // outermost only — do not re-report this defect's own children
      }
      if (child.hasError) visit(child);
    }
  };
  visit(root);
  return errors;
}

/**
 * The user-facing message. A MISSING node is the useful case — the grammar names the exact token it
 * wanted, so we can say "expected `}`" instead of the useless "there is a syntax error here". An
 * ERROR node means the grammar could not even guess, so the message stays honest about that rather
 * than inventing a cause.
 */
function messageFor(language: 'css' | 'html', error: SyntaxError): string {
  if (error.missing && error.expected !== '') {
    return `Invalid ${LABEL[language]}: expected \`${error.expected}\` here.`;
  }
  return `Invalid ${LABEL[language]}: this is not valid ${LABEL[language]} syntax.`;
}

/**
 * A Tier-B syntax validator for one language. `css` and `html` differ only in grammar, rule id,
 * severity and label, so they share one implementation rather than two near-copies that would drift.
 */
export function createSyntaxAnalyzer(language: 'css' | 'html'): Analyzer {
  return {
    id: language,

    // No external tool and no capability gate: validity can always be checked from the grammar.
    supports() {
      return true;
    },

    async *run(context, signal): AsyncIterable<Finding> {
      // Read through a call, not the property directly: `signal.aborted` genuinely flips across the
      // `await parse(...)` below, but TypeScript narrows the property after the first check and would
      // then treat every later check as dead code. Same helper `complexity.ts` uses, for the same reason.
      const aborted = (): boolean => signal.aborted;
      for (const file of context.files) {
        if (aborted()) return;
        if (file.language !== (language satisfies Language)) continue;
        const source = context.readSource(file.absPath);
        if (source === null) continue;

        let errors: SyntaxError[];
        /** Missed-semicolon findings, which a clean parse can still contain (see below). */
        const semicolons: {
          offset: number;
          line: number;
          column: number;
          /**
           * The enclosing construct, resolved while the tree is still alive (the tree is disposed
           * before these are yielded). Same treatment — and same reason — as `error.enclosing` on the
           * delimiter path below: without it the repair target collapses to the finding's own line,
           * which for CSS is a bare `color: #333` declaration. That is not a construct that parses on
           * its own, so the model is asked to repair a fragment and its reply cannot be spliced back
           * without breaking the rule around it.
           */
          enclosing?: { startLine: number; endLine: number } | null;
        }[] = [];
        try {
          const tree = await parse(language, source, file.file);
          try {
            // CSS only, and BEFORE the `hasError` shortcut: a missed semicolon parses cleanly, so
            // returning early on a valid tree would skip the one defect the grammar cannot see.
            if (language === 'css') {
              eachDeclaration(tree.root, (node) => {
                if (semicolons.length >= MAX_ERRORS_PER_FILE) return;
                const found = findMissingSemicolon(node.text, node.startIndex);
                if (found !== null) {
                  const before = source.slice(0, found.offset);
                  const line = before.split('\n').length;
                  const column = found.offset - (before.lastIndexOf('\n') + 1) + 1;
                  semicolons.push({ offset: found.offset, line, column });
                }
              });
            }
            errors = tree.root.hasError ? collectErrors(tree.root, MAX_ERRORS_PER_FILE) : [];
            // Tailwind v4 directives are valid CSS-in-Tailwind that this grammar cannot read. CSS
            // only: the HTML validator shares this code path and has no such vocabulary.
            if (language === 'css' && errors.length > 0) {
              errors = withoutTailwindNoise(errors, source.split(/\r?\n/));
            }
            // Root Cause A: these findings carried NO enclosing range, so the repair target collapsed
            // to the finding's own line — and for an unbalanced delimiter that line is where the
            // parser gave up, often a different and perfectly valid rule. Resolved here, while the
            // tree is still alive, to the outermost construct that actually contains the defect.
            for (const error of errors) {
              error.enclosing = outermostConstructContaining(tree.root, error.line);
            }
            // The same resolution for the missed-semicolon findings, for the same reason. Done here,
            // inside the try, because `tree` is disposed in the `finally` below and these findings
            // are not yielded until after that.
            for (const found of semicolons) {
              found.enclosing = outermostConstructContaining(tree.root, found.line);
            }
          } finally {
            tree.dispose();
          }
        } catch {
          // A grammar that cannot load is an engine problem, not a defect in the user's file —
          // reporting it as a finding would blame their code for our failure. Skip the file, exactly
          // as the JSON validator does when tree-sitter is unavailable.
          continue;
        }

        const lines = source.split(/\r?\n/);
        for (const error of errors) {
          if (aborted()) return;
          const snippet = lines[error.line - 1] ?? '';
          const finding: Finding = {
            id: findingId({
              source: language,
              ruleId: RULE_ID[language],
              file: file.file,
              snippet,
            }),
            source: language,
            ruleId: RULE_ID[language],
            severity: SEVERITY[language],
            category: 'correctness',
            location: {
              file: file.file,
              startLine: error.line,
              startCol: error.column,
              endLine: error.line,
              endCol: error.column,
            },
            message: messageFor(language, error),
            evidence: {
              // The repair target. Without this the engine falls back to the finding's own line,
              // which for a delimiter error excludes the defect entirely.
              ...(error.enclosing !== null && error.enclosing !== undefined
                ? {
                    enclosingRange: {
                      startLine: error.enclosing.startLine,
                      endLine: error.enclosing.endLine,
                    },
                  }
                : {}),
              snippet,
              relatedLocations: [],
              toolOutput: { missing: error.missing, expected: error.expected },
            },
            // A grammar error names no specific edit, so nothing here is `safe-auto`;
            // `classifyRepair` resolves this to `ai-required`, which is what makes it repairable.
            fixable: false,
            repair: 'ai-required',
            confidence: 1,
          };
          finding.repair = classifyRepair(finding);
          yield finding;
        }

        // The missed semicolon, with its fix attached. This is the highest-confidence repair the
        // engine can offer for any language: the edit is a single character at a known offset, so it
        // needs no model at all — `classifyRepair` sees the `autofix` and returns `safe-auto`, which
        // routes it through `deterministicRepair` (parser gate) and then the verifier, exactly like
        // an ESLint or Ruff autofix.
        for (const found of semicolons) {
          if (aborted()) return;
          const snippet = lines[found.line - 1] ?? '';
          const finding: Finding = {
            id: findingId({
              source: language,
              ruleId: CSS_MISSING_SEMICOLON,
              file: file.file,
              snippet,
            }),
            source: language,
            ruleId: CSS_MISSING_SEMICOLON,
            severity: 'error',
            category: 'correctness',
            location: {
              file: file.file,
              startLine: found.line,
              startCol: found.column,
              endLine: found.line,
              endCol: found.column,
            },
            message:
              'Missing `;` after this declaration — the browser drops this rule and the one after it.',
            evidence: {
              // The repair target. Without it the engine falls back to the finding's own line — a
              // bare `color: #333`, which does not parse standalone — so an AI repair of this finding
              // was generated against a fragment and rejected by the parser gate on splice.
              ...(found.enclosing !== null && found.enclosing !== undefined
                ? {
                    enclosingRange: {
                      startLine: found.enclosing.startLine,
                      endLine: found.enclosing.endLine,
                    },
                  }
                : {}),
              snippet,
              relatedLocations: [],
              toolOutput: { offset: found.offset },
            },
            fixable: true,
            autofix: {
              source: language,
              edits: [{ range: [found.offset, found.offset], text: ';' }],
            },
            repair: 'safe-auto',
            confidence: 1,
          };
          finding.repair = classifyRepair(finding);
          yield finding;
        }
      }
    },
  };
}
