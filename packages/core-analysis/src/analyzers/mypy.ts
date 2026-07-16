import { relative, sep } from 'node:path';

import type { Analyzer } from '../analyzer.js';
import { runTool } from '../process/run-tool.js';
import { resolvePathTool } from '../tools/resolve.js';

import { groundByFile, type AdapterDeps, type RawFinding } from './support.js';

/**
 * The mypy adapter (Python type errors, ADR-025). Runs the workspace's mypy **once** over the
 * directory with column numbers and normalises its `file:line:col: error: message [code]` text. The
 * rule id is mypy's own error code (e.g. `arg-type`), so findings line up with the user's mypy CI.
 */

// `path:line:col: error|warning|note: message  [code]` — non-greedy path so the first `:digits:` wins.
const DIAGNOSTIC = /^(.+?):(\d+):(\d+):\s+(error|warning|note):\s+(.*)$/;
const TRAILING_CODE = /\s+\[([a-z0-9-]+)\]\s*$/;

function toRelPosix(root: string, file: string): string {
  const rel = file.startsWith('/') || file.includes(':\\') ? relative(root, file) : file;
  return rel.split(sep).join('/');
}

export function createMypyAnalyzer(deps: AdapterDeps = {}): Analyzer {
  const runner = deps.runner ?? runTool;
  const resolveTool = deps.resolveTool ?? (() => resolvePathTool('mypy'));

  return {
    id: 'mypy',

    supports(capabilities) {
      return capabilities.tools.has('mypy');
    },

    async *run(context, signal) {
      if (!context.files.some((f) => f.language === 'python')) return;
      const tool = resolveTool(context.root);
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
            '.',
          ],
          cwd: context.root,
          signal,
          timeoutMs: 180_000,
        });
      } catch {
        return;
      }
      if (signal.aborted) return;

      const byFile = new Map<string, RawFinding[]>();
      for (const line of run.stdout.split(/\r?\n/)) {
        const match = DIAGNOSTIC.exec(line);
        if (match === null) continue;
        const [, rawFile, lineStr, colStr, level, rawMessage] = match;
        if (
          rawFile === undefined ||
          lineStr === undefined ||
          colStr === undefined ||
          rawMessage === undefined
        ) {
          continue;
        }
        if (level === 'note') continue; // notes annotate a prior error; not a finding on their own

        let message = rawMessage;
        let ruleId = 'mypy';
        const code = TRAILING_CODE.exec(message);
        if (code?.[1] !== undefined) {
          ruleId = code[1];
          message = message.slice(0, code.index);
        }
        const file = toRelPosix(context.root, rawFile);
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
        const list = byFile.get(file);
        if (list === undefined) byFile.set(file, [raw]);
        else list.push(raw);
      }

      yield* groundByFile('mypy', context, byFile, signal);
    },
  };
}
