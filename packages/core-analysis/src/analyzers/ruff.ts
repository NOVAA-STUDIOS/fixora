import type { Category, Finding } from '@fixora/shared-types';

import type { Analyzer, AnalysisTarget } from '../analyzer.js';
import { runTool } from '../process/run-tool.js';
import { parseStructure } from '../structure.js';
import { resolvePathTool } from '../tools/resolve.js';

import { createGrounder, type AdapterDeps, type RawFinding } from './support.js';

/**
 * The ruff adapter (Python, ADR-025). ruff is the fast, ubiquitous Python linter; it reads the
 * in-memory content over stdin (`--stdin-filename`) so it sees unsaved edits, and emits JSON we
 * normalise to `Finding`s. As with eslint, it is the *workspace's* ruff with the *workspace's*
 * config, so findings match the user's CI.
 */

interface RuffPoint {
  row: number;
  column: number;
}
interface RuffMessage {
  code: string | null;
  message: string;
  location: RuffPoint;
  end_location?: RuffPoint;
  fix?: unknown;
}

/** Map a ruff code prefix to a category (ruff has no severity/category taxonomy of its own). */
function categoryFor(code: string): Category {
  const prefix = code[0];
  if (prefix === 'S') return 'security'; // flake8-bandit
  if (code.startsWith('PLR') || prefix === 'C') return 'maintainability'; // refactor / complexity
  if (prefix === 'E' || prefix === 'W' || prefix === 'D' || prefix === 'Q') return 'style';
  return 'correctness'; // F (pyflakes), B (bugbear), etc.
}

export function createRuffAnalyzer(deps: AdapterDeps = {}): Analyzer {
  const runner = deps.runner ?? runTool;
  const resolveTool =
    deps.resolveTool ?? ((): ReturnType<typeof resolvePathTool> => resolvePathTool('ruff'));
  return {
    id: 'ruff',

    supports(language, workspace) {
      return language === 'python' && workspace.tools.has('ruff');
    },

    async *analyze(target: AnalysisTarget, signal: AbortSignal): AsyncIterable<Finding> {
      const tool = resolveTool(target);
      if (tool === null) return;

      let run;
      try {
        run = await runner({
          command: tool.command,
          args: [
            ...tool.args,
            'check',
            '--output-format',
            'json',
            '--stdin-filename',
            target.absPath,
            '-',
          ],
          cwd: target.workspaceRoot,
          input: target.source,
          signal,
        });
      } catch {
        return;
      }
      if (run.stdout.trim() === '') return;

      let messages: RuffMessage[];
      try {
        messages = JSON.parse(run.stdout) as RuffMessage[];
      } catch {
        return;
      }

      const { symbols } = await parseStructure(target.language, target.source, target.file);
      const grounder = createGrounder('ruff', target, symbols);

      for (const message of messages) {
        if (signal.aborted) return;
        if (message.code === null) continue; // syntax errors surface elsewhere, not as a rule finding
        const raw: RawFinding = {
          ruleId: message.code,
          severity: 'warning', // ruff violations are uniform; grounding confidence is 1 regardless
          category: categoryFor(message.code),
          message: message.message,
          startLine: message.location.row,
          startCol: message.location.column,
          ...(message.end_location !== undefined
            ? { endLine: message.end_location.row, endCol: message.end_location.column }
            : {}),
          fixable: message.fix !== undefined && message.fix !== null,
          toolOutput: message,
        };
        yield grounder.ground(raw);
      }
    },
  };
}
