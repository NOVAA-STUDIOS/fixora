import type { Finding } from '@fixora/shared-types';

import type { Analyzer, AnalysisTarget } from '../analyzer.js';
import { runTool } from '../process/run-tool.js';
import { parseStructure } from '../structure.js';
import { resolvePathTool } from '../tools/resolve.js';

import { createGrounder, type AdapterDeps, type RawFinding } from './support.js';

/**
 * The mypy adapter (Python type errors, ADR-025). Runs the workspace's mypy over the file with column
 * numbers, and normalises its `file:line:col: error: message [code]` text. The rule id is mypy's own
 * error code (e.g. `arg-type`), so findings line up with what the user's mypy CI reports.
 */

// `path:line:col: error|warning|note: message  [code]`  — non-greedy path so the first `:digits:` wins.
const DIAGNOSTIC = /^(.+?):(\d+):(\d+):\s+(error|warning|note):\s+(.*)$/;
const TRAILING_CODE = /\s+\[([a-z0-9-]+)\]\s*$/;

export function createMypyAnalyzer(deps: AdapterDeps = {}): Analyzer {
  const runner = deps.runner ?? runTool;
  const resolveTool =
    deps.resolveTool ?? ((): ReturnType<typeof resolvePathTool> => resolvePathTool('mypy'));
  return {
    id: 'mypy',

    supports(language, workspace) {
      return language === 'python' && workspace.tools.has('mypy');
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
            '--no-error-summary',
            '--show-column-numbers',
            '--no-color-output',
            target.absPath,
          ],
          cwd: target.workspaceRoot,
          signal,
          timeoutMs: 120_000,
        });
      } catch {
        return;
      }

      const { symbols } = await parseStructure(target.language, target.source, target.file);
      const grounder = createGrounder('mypy', target, symbols);

      for (const line of run.stdout.split(/\r?\n/)) {
        if (signal.aborted) return;
        const match = DIAGNOSTIC.exec(line);
        if (match === null) continue;
        const [, , lineStr, colStr, level, rawMessage] = match;
        if (lineStr === undefined || colStr === undefined || rawMessage === undefined) continue;
        if (level === 'note') continue; // notes annotate a prior error; not a finding on their own

        let message = rawMessage;
        let ruleId = 'mypy';
        const code = TRAILING_CODE.exec(message);
        if (code?.[1] !== undefined) {
          ruleId = code[1];
          message = message.slice(0, code.index);
        }
        const raw: RawFinding = {
          ruleId,
          severity: level === 'error' ? 'error' : 'warning',
          category: 'correctness',
          message,
          startLine: Number(lineStr),
          startCol: Number(colStr),
          fixable: false,
          toolOutput: line,
        };
        yield grounder.ground(raw);
      }
    },
  };
}
