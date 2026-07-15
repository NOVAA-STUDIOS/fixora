import { existsSync } from 'node:fs';
import { join } from 'node:path';

import type { Category, Finding, Language, Severity } from '@fixora/shared-types';

import type { Analyzer, AnalysisTarget, WorkspaceCapabilities } from '../analyzer.js';
import { runTool } from '../process/run-tool.js';
import { parseStructure } from '../structure.js';
import { resolvePathTool } from '../tools/resolve.js';

import { createGrounder, type AdapterDeps, type RawFinding } from './support.js';

/**
 * The Semgrep adapter — cross-language security (ADR-025). Semgrep needs a ruleset; running `--config
 * auto` would fetch rules over the network, which violates local-first (offline must work). So this
 * adapter runs **only when the workspace ships its own Semgrep config** — that is the ruleset the
 * user's CI uses, which is exactly the point (ADR-007). No config, no Semgrep findings, and we can
 * say so ("add a Semgrep config for security analysis").
 */

const CONFIG_FILES = ['.semgrep.yml', '.semgrep.yaml', 'semgrep.yml', 'semgrep.yaml'];

/** The languages we drive Semgrep for — all four we analyze (it is cross-language). */
const SEMGREP_LANGUAGES = new Set<Language>(['typescript', 'javascript', 'python', 'go']);

function semgrepConfig(root: string): string | null {
  for (const name of CONFIG_FILES) {
    const path = join(root, name);
    if (existsSync(path)) return path;
  }
  return null;
}

interface SemgrepPoint {
  line: number;
  col: number;
}
interface SemgrepResult {
  check_id: string;
  start: SemgrepPoint;
  end?: SemgrepPoint;
  extra?: {
    message?: string;
    severity?: string;
    fix?: unknown;
    metadata?: { category?: string };
  };
}

const OUR_CATEGORIES = new Set<Category>([
  'correctness',
  'security',
  'performance',
  'maintainability',
  'style',
]);

function categoryFor(result: SemgrepResult): Category {
  const meta = result.extra?.metadata?.category;
  return meta !== undefined && OUR_CATEGORIES.has(meta as Category)
    ? (meta as Category)
    : 'security';
}

function severityFor(raw: string | undefined): Severity {
  if (raw === 'ERROR') return 'error';
  if (raw === 'INFO') return 'info';
  return 'warning';
}

export function createSemgrepAnalyzer(deps: AdapterDeps = {}): Analyzer {
  const runner = deps.runner ?? runTool;
  const resolveTool =
    deps.resolveTool ?? ((): ReturnType<typeof resolvePathTool> => resolvePathTool('semgrep'));
  return {
    id: 'semgrep',

    // Semgrep is cross-language; it applies to any workspace that ships a config and has the tool.
    supports(language, workspace: WorkspaceCapabilities) {
      return (
        SEMGREP_LANGUAGES.has(language) &&
        workspace.tools.has('semgrep') &&
        semgrepConfig(workspace.root) !== null
      );
    },

    async *analyze(target: AnalysisTarget, signal: AbortSignal): AsyncIterable<Finding> {
      const tool = resolveTool(target);
      const config = semgrepConfig(target.workspaceRoot);
      if (tool === null || config === null) return;

      let run;
      try {
        run = await runner({
          command: tool.command,
          args: [...tool.args, 'scan', '--json', '--quiet', '--config', config, target.absPath],
          cwd: target.workspaceRoot,
          signal,
          timeoutMs: 120_000,
        });
      } catch {
        return;
      }
      if (run.stdout.trim() === '') return;

      let report: { results?: SemgrepResult[] };
      try {
        report = JSON.parse(run.stdout) as { results?: SemgrepResult[] };
      } catch {
        return;
      }

      const { symbols } = await parseStructure(target.language, target.source, target.file);
      const grounder = createGrounder('semgrep', target, symbols);

      for (const result of report.results ?? []) {
        if (signal.aborted) return;
        const raw: RawFinding = {
          ruleId: result.check_id,
          severity: severityFor(result.extra?.severity),
          category: categoryFor(result),
          message: result.extra?.message ?? result.check_id,
          startLine: result.start.line,
          startCol: result.start.col,
          ...(result.end !== undefined ? { endLine: result.end.line, endCol: result.end.col } : {}),
          fixable: result.extra?.fix !== undefined && result.extra.fix !== null,
          toolOutput: result,
        };
        yield grounder.ground(raw);
      }
    },
  };
}
