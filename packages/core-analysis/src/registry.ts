import type { Analyzer, WorkspaceCapabilities } from './analyzer.js';
import { complexityAnalyzer } from './analyzers/complexity.js';
import { createEslintAnalyzer } from './analyzers/eslint.js';
import { createGoVetAnalyzer } from './analyzers/go-vet.js';
import { createJsonAnalyzer } from './analyzers/json.js';
import { createMypyAnalyzer } from './analyzers/mypy.js';
import { createRuffAnalyzer } from './analyzers/ruff.js';
import { createSemgrepAnalyzer } from './analyzers/semgrep.js';
import { createSyntaxAnalyzer } from './analyzers/syntax.js';
import { createTscAnalyzer } from './analyzers/tsc.js';

/**
 * The default analyzer roster. `complexity` always applies (tree-sitter, no tool); the rest apply
 * only when the workspace has their tool (ADR-007). This is the whole engine's grounding surface —
 * and it contains zero AI (ADR-002).
 */
export function defaultAnalyzers(): Analyzer[] {
  return [
    complexityAnalyzer,
    createEslintAnalyzer(),
    createTscAnalyzer(),
    createRuffAnalyzer(),
    createMypyAnalyzer(),
    createGoVetAnalyzer(),
    createSemgrepAnalyzer(),
    createJsonAnalyzer(),
    // Tier-B syntax validators. Like the JSON one they need no tool, so they always apply — which is
    // what makes CSS/HTML analyzable (and therefore repairable) at all.
    createSyntaxAnalyzer('css'),
    createSyntaxAnalyzer('html'),
  ];
}

/** The analyzers active in this workspace — the ones whose tool is present. */
export function applicableAnalyzers(
  analyzers: readonly Analyzer[],
  capabilities: WorkspaceCapabilities,
): Analyzer[] {
  return analyzers.filter((analyzer) => analyzer.supports(capabilities));
}
