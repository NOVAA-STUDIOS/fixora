import type { Category, Finding, Severity } from '@fixora/shared-types';

import type { Analyzer, AnalysisTarget } from '../analyzer.js';
import { findingId } from '../finding-id.js';
import { runTool, type ToolRunner } from '../process/run-tool.js';
import { parseStructure } from '../structure.js';
import { enclosingSymbol } from '../symbols/symbols.js';
import { resolveNodeTool } from '../tools/resolve.js';

/**
 * The ESLint adapter — the flagship for the TS/JS market (ADR-025). It runs the **workspace's own**
 * eslint with the **workspace's own config** (via `--stdin`, so it lints the in-memory content
 * including unsaved edits), then normalises ESLint's JSON to `Finding`s. Because it is the user's
 * eslint at the user's version with the user's rules, our findings match their CI — a tool that
 * argues with your CI is a tool you uninstall (TDD §5.2).
 */

interface EslintMessage {
  ruleId: string | null;
  severity: 0 | 1 | 2;
  message: string;
  line: number;
  column: number;
  endLine?: number;
  endColumn?: number;
  fix?: unknown;
}
interface EslintFileResult {
  messages: EslintMessage[];
}

/** ESLint has no category taxonomy; heuristic — an error is treated as correctness, a warning as style. */
function categoryFor(severity: 1 | 2): Category {
  return severity === 2 ? 'correctness' : 'style';
}

function sourceLine(lines: readonly string[], line: number): string {
  return lines[line - 1] ?? '';
}

export function createEslintAnalyzer(runner: ToolRunner = runTool): Analyzer {
  return {
    id: 'eslint',

    supports(language, workspace) {
      return (
        (language === 'typescript' || language === 'javascript') && workspace.tools.has('eslint')
      );
    },

    async *analyze(target: AnalysisTarget, signal: AbortSignal): AsyncIterable<Finding> {
      const tool = resolveNodeTool(target.workspaceRoot, 'eslint');
      if (tool === null) return;

      let run;
      try {
        run = await runner({
          command: tool.command,
          args: [...tool.args, '--format', 'json', '--stdin', '--stdin-filename', target.absPath],
          cwd: target.workspaceRoot,
          input: target.source,
          signal,
        });
      } catch {
        return; // aborted or the process failed to spawn — no findings, never throw
      }
      if (run.stdout.trim() === '') return;

      let results: EslintFileResult[];
      try {
        results = JSON.parse(run.stdout) as EslintFileResult[];
      } catch {
        return; // not JSON (a crash or a config error) — degrade to nothing rather than a bad finding
      }

      const lines = target.source.split(/\r?\n/);
      const { symbols } = await parseStructure(target.language, target.source, target.file);

      for (const file of results) {
        for (const message of file.messages) {
          if (signal.aborted) return;
          if (message.ruleId === null) continue; // parse errors / config problems, not lint findings
          const severity: Severity = message.severity === 2 ? 'error' : 'warning';
          const symbol = enclosingSymbol(symbols, message.line);
          const snippet = sourceLine(lines, message.line);
          yield {
            id: findingId({
              source: 'eslint',
              ruleId: message.ruleId,
              file: target.file,
              enclosingSymbol: symbol,
              snippet,
            }),
            source: 'eslint',
            ruleId: message.ruleId,
            severity,
            category: categoryFor(message.severity === 2 ? 2 : 1),
            location: {
              file: target.file,
              startLine: message.line,
              startCol: message.column,
              endLine: message.endLine ?? message.line,
              endCol: message.endColumn ?? message.column,
            },
            message: message.message,
            evidence: {
              ...(symbol !== undefined ? { enclosingSymbol: symbol } : {}),
              snippet,
              relatedLocations: [],
              toolOutput: message,
            },
            fixable: message.fix !== undefined,
            confidence: 1,
          };
        }
      }
    },
  };
}
