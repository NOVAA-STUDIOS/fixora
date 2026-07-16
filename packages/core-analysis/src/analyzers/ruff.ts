import { relative, sep } from 'node:path';

import type { Category } from '@fixora/shared-types';

import type { Analyzer } from '../analyzer.js';
import { runTool } from '../process/run-tool.js';
import { resolvePathTool } from '../tools/resolve.js';

import { groundByFile, type AdapterDeps, type RawFinding } from './support.js';

/**
 * The ruff adapter (Python, ADR-025). Runs the workspace's ruff **once** over the directory and
 * normalises its JSON. As with eslint it is the *workspace's* ruff with the *workspace's* config, so
 * findings match the user's CI.
 */

interface RuffPoint {
  row: number;
  column: number;
}
interface RuffMessage {
  code: string | null;
  message: string;
  filename: string;
  location: RuffPoint;
  end_location?: RuffPoint;
  fix?: unknown;
}

function categoryFor(code: string): Category {
  const prefix = code[0];
  if (prefix === 'S') return 'security';
  if (code.startsWith('PLR') || prefix === 'C') return 'maintainability';
  if (prefix === 'E' || prefix === 'W' || prefix === 'D' || prefix === 'Q') return 'style';
  return 'correctness';
}

function toRelPosix(root: string, absPath: string): string {
  return relative(root, absPath).split(sep).join('/');
}

export function createRuffAnalyzer(deps: AdapterDeps = {}): Analyzer {
  const runner = deps.runner ?? runTool;
  const resolveTool = deps.resolveTool ?? (() => resolvePathTool('ruff'));

  return {
    id: 'ruff',

    supports(capabilities) {
      return capabilities.tools.has('ruff');
    },

    async *run(context, signal) {
      if (!context.files.some((f) => f.language === 'python')) return;
      const tool = resolveTool(context.root);
      if (tool === null) return;

      let run;
      try {
        run = await runner({
          command: tool.command,
          args: [...tool.args, 'check', '--output-format', 'json', '.'],
          cwd: context.root,
          signal,
        });
      } catch {
        return;
      }
      if (signal.aborted || run.stdout.trim() === '') return;

      let messages: RuffMessage[];
      try {
        messages = JSON.parse(run.stdout) as RuffMessage[];
      } catch {
        return;
      }

      const byFile = new Map<string, RawFinding[]>();
      for (const message of messages) {
        if (message.code === null) continue;
        const file = toRelPosix(context.root, message.filename);
        const raw: RawFinding = {
          ruleId: message.code,
          severity: 'warning',
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
        const list = byFile.get(file);
        if (list === undefined) byFile.set(file, [raw]);
        else list.push(raw);
      }

      yield* groundByFile('ruff', context, byFile, signal);
    },
  };
}
