import type { Finding, Language, Severity, SymbolKind, SymbolRef } from '@fixora/shared-types';
import { type Node, Query } from 'web-tree-sitter';

import type { AnalysisContext, Analyzer } from '../analyzer.js';
import { findingId } from '../finding-id.js';
import { parse } from '../parser/tree-sitter.js';

/**
 * The languages this analyzer measures: the tree-sitter "deep" set, excluding validation-only
 * languages like JSON that have no functions to measure. Typing the node maps to this subset keeps a
 * new validation language out of them by construction.
 */
type CodeLanguage = Exclude<Language, 'json'>;

/**
 * The complexity analyzer: cyclomatic and cognitive complexity from tree-sitter, no external tool
 * (ADR-002 grounding that always works, even offline with nothing installed). It is the proof that
 * "Fixora is useful with the LLM — and every external linter — switched off": on any of the three
 * languages it surfaces the functions a maintainer should look at first.
 *
 * Cyclomatic is the classic 1 + decision-points. Cognitive is an approximation of the SonarSource
 * metric — each control structure costs 1 plus its nesting depth, and boolean operators cost 1 —
 * which captures the load-bearing idea that *nested* branching is disproportionately hard to read.
 */

/** Report functions at or above these; tuned to the common ESLint (20) / SonarSource (15) defaults. */
const CYCLOMATIC_WARN = 11;
const CYCLOMATIC_ERROR = 21;
const COGNITIVE_WARN = 16;
const COGNITIVE_ERROR = 31;

/** Function-like nodes: the boundaries we measure, and the nested ones we do NOT fold into a parent. */
const FUNCTION_NODES: Record<CodeLanguage, ReadonlySet<string>> = {
  typescript: new Set([
    'function_declaration',
    'function_expression',
    'generator_function_declaration',
    'method_definition',
    'arrow_function',
  ]),
  javascript: new Set([
    'function_declaration',
    'function_expression',
    'generator_function_declaration',
    'method_definition',
    'arrow_function',
  ]),
  python: new Set(['function_definition']),
  go: new Set(['function_declaration', 'method_declaration', 'func_literal']),
};

/** Nodes that add a decision point (+1 cyclomatic). `else`/`default` are excluded — they add no path. */
const BRANCH_NODES: Record<CodeLanguage, ReadonlySet<string>> = {
  typescript: new Set([
    'if_statement',
    'for_statement',
    'for_in_statement',
    'while_statement',
    'do_statement',
    'switch_case',
    'catch_clause',
    'ternary_expression',
  ]),
  javascript: new Set([
    'if_statement',
    'for_statement',
    'for_in_statement',
    'while_statement',
    'do_statement',
    'switch_case',
    'catch_clause',
    'ternary_expression',
  ]),
  python: new Set([
    'if_statement',
    'elif_clause',
    'for_statement',
    'while_statement',
    'except_clause',
    'conditional_expression',
    'if_clause',
    'for_in_clause',
  ]),
  go: new Set(['if_statement', 'for_statement', 'expression_case', 'communication_case']),
};

/** Branch nodes that also introduce a nesting level (for cognitive complexity). */
const NESTING_NODES: Record<CodeLanguage, ReadonlySet<string>> = {
  typescript: new Set([
    'if_statement',
    'for_statement',
    'for_in_statement',
    'while_statement',
    'do_statement',
    'switch_case',
    'catch_clause',
  ]),
  javascript: new Set([
    'if_statement',
    'for_statement',
    'for_in_statement',
    'while_statement',
    'do_statement',
    'switch_case',
    'catch_clause',
  ]),
  python: new Set([
    'if_statement',
    'elif_clause',
    'for_statement',
    'while_statement',
    'except_clause',
  ]),
  go: new Set(['if_statement', 'for_statement', 'expression_case', 'communication_case']),
};

const FUNCTION_QUERIES: Record<CodeLanguage, string> = {
  typescript: `
    (function_declaration name: (identifier) @name) @fn
    (method_definition name: (property_identifier) @name) @fn
    (variable_declarator name: (identifier) @name value: (arrow_function)) @fn
  `,
  javascript: `
    (function_declaration name: (identifier) @name) @fn
    (method_definition name: (property_identifier) @name) @fn
    (variable_declarator name: (identifier) @name value: (arrow_function)) @fn
  `,
  python: `(function_definition name: (identifier) @name) @fn`,
  go: `
    (function_declaration name: (identifier) @name) @fn
    (method_declaration name: (field_identifier) @name) @fn
  `,
};

/** Is this node a short-circuiting boolean operator (each one adds a path)? */
function isLogicalOperator(node: Node, language: Language): boolean {
  if (language === 'python') return node.type === 'boolean_operator';
  if (node.type !== 'binary_expression') return false;
  const op = node.childForFieldName('operator')?.text;
  return op === '&&' || op === '||';
}

interface Metrics {
  cyclomatic: number;
  cognitive: number;
}

/** Walk one function body, counting decision points; never fold a nested function into this one. */
function measure(fnNode: Node, language: CodeLanguage): Metrics {
  const branches = BRANCH_NODES[language];
  const nesting = NESTING_NODES[language];
  const functions = FUNCTION_NODES[language];
  let cyclomatic = 1;
  let cognitive = 0;

  const visit = (node: Node, depth: number, isRoot: boolean): void => {
    if (!isRoot && functions.has(node.type)) return; // a nested function is measured on its own
    let childDepth = depth;
    if (branches.has(node.type)) {
      cyclomatic += 1;
      cognitive += 1 + depth;
      if (nesting.has(node.type)) childDepth = depth + 1;
    }
    if (isLogicalOperator(node, language)) {
      cyclomatic += 1;
      cognitive += 1;
    }
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
      if (child !== null) visit(child, childDepth, false);
    }
  };
  visit(fnNode, 0, true);
  return { cyclomatic, cognitive };
}

function severityFor(value: number, warn: number, error: number): Severity | null {
  if (value >= error) return 'error';
  if (value >= warn) return 'warning';
  return null;
}

function toSymbol(name: string, kind: SymbolKind, node: Node, file: string): SymbolRef {
  return {
    name,
    kind,
    location: {
      file,
      startLine: node.startPosition.row + 1,
      startCol: node.startPosition.column + 1,
      endLine: node.endPosition.row + 1,
      endCol: node.endPosition.column + 1,
    },
  };
}

function complexityFinding(
  ruleId: 'cyclomatic-complexity' | 'cognitive-complexity',
  label: string,
  value: number,
  threshold: number,
  severity: Severity,
  symbol: SymbolRef,
  file: string,
): Finding {
  const snippet = `${symbol.kind} ${symbol.name}`;
  return {
    id: findingId({
      source: 'complexity',
      ruleId,
      file,
      enclosingSymbol: symbol,
      snippet,
    }),
    source: 'complexity',
    ruleId,
    severity,
    category: 'maintainability',
    location: symbol.location,
    message: `${symbol.kind} '${symbol.name}' has ${label} of ${String(value)} (threshold ${String(threshold)}).`,
    evidence: {
      enclosingSymbol: symbol,
      snippet,
      relatedLocations: [],
      toolOutput: { metric: ruleId, value, threshold },
    },
    fixable: false,
    // High complexity is advice, not a defect with a mechanical fix: how (or whether) to refactor is
    // the developer's judgement, so this is never auto- or AI-applied.
    repair: 'manual',
    confidence: 1,
  };
}

/** The kind of a function-like declaration node, for the symbol we attach to the finding. */
function functionKind(node: Node): SymbolKind {
  return node.type === 'method_definition' || node.type === 'method_declaration'
    ? 'method'
    : 'function';
}

export const complexityAnalyzer: Analyzer = {
  id: 'complexity',

  // Tree-sitter based: it needs no external tool, so it is always active.
  supports(): boolean {
    return true;
  },

  async *run(context: AnalysisContext, signal: AbortSignal): AsyncIterable<Finding> {
    // Read the signal through a call so a later check is not narrowed to a constant by the compiler.
    const aborted = (): boolean => signal.aborted;
    for (const analysisFile of context.files) {
      if (aborted()) return;
      // Validation-only languages (JSON) have no functions to measure — skip before parsing, which
      // also narrows the language to the code set the node maps are keyed by.
      const language = analysisFile.language;
      if (language === 'json') continue;
      const source = context.readSource(analysisFile.absPath);
      if (source === null) continue;
      const parsed = await parse(language, source, analysisFile.file);
      try {
        const query = new Query(parsed.grammar, FUNCTION_QUERIES[language]);
        try {
          for (const match of query.matches(parsed.root)) {
            if (aborted()) return;
            let fnNode: Node | undefined;
            let nameNode: Node | undefined;
            for (const capture of match.captures) {
              if (capture.name === 'fn') fnNode = capture.node;
              else if (capture.name === 'name') nameNode = capture.node;
            }
            if (fnNode === undefined || nameNode === undefined) continue;

            const symbol = toSymbol(nameNode.text, functionKind(fnNode), fnNode, analysisFile.file);
            const { cyclomatic, cognitive } = measure(fnNode, language);

            const cycSeverity = severityFor(cyclomatic, CYCLOMATIC_WARN, CYCLOMATIC_ERROR);
            if (cycSeverity !== null) {
              yield complexityFinding(
                'cyclomatic-complexity',
                'a cyclomatic complexity',
                cyclomatic,
                CYCLOMATIC_WARN,
                cycSeverity,
                symbol,
                analysisFile.file,
              );
            }
            const cogSeverity = severityFor(cognitive, COGNITIVE_WARN, COGNITIVE_ERROR);
            if (cogSeverity !== null) {
              yield complexityFinding(
                'cognitive-complexity',
                'a cognitive complexity',
                cognitive,
                COGNITIVE_WARN,
                cogSeverity,
                symbol,
                analysisFile.file,
              );
            }
          }
        } finally {
          query.delete();
        }
      } finally {
        parsed.dispose();
      }
    }
  },
};
