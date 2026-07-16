import { relative, sep } from 'node:path';

import type { Analyzer } from '../analyzer.js';
import { runTool } from '../process/run-tool.js';
import { resolveNodeTool } from '../tools/resolve.js';

import { groundByFile, type AdapterDeps, type RawFinding } from './support.js';

/**
 * The tsc adapter (TypeScript type errors, ADR-025). The type-checker is inherently project-wide, so
 * it runs `tsc --noEmit` over the workspace's own tsconfig **once** and we distribute the diagnostics
 * across their files. (This is the analyzer whose per-file invocation was the original performance
 * bug; workspace-scope is the fix.)
 */

// `file(line,col): error TSxxxx: message` — the `--pretty false` diagnostic line.
const DIAGNOSTIC = /^(.+?)\((\d+),(\d+)\):\s+(error|warning)\s+(TS\d+):\s+(.*)$/;

function toRelPosix(root: string, file: string): string {
  const rel = file.includes(':') || file.startsWith('/') ? relative(root, file) : file;
  return rel.split(sep).join('/');
}

export function createTscAnalyzer(deps: AdapterDeps = {}): Analyzer {
  const runner = deps.runner ?? runTool;
  const resolveTool =
    deps.resolveTool ?? ((root: string) => resolveNodeTool(root, 'typescript', 'tsc'));

  return {
    id: 'tsc',

    supports(capabilities) {
      return capabilities.tools.has('tsc');
    },

    async *run(context, signal) {
      if (!context.files.some((f) => f.language === 'typescript')) return;
      const tool = resolveTool(context.root);
      if (tool === null) return;

      let run;
      try {
        run = await runner({
          command: tool.command,
          args: [...tool.args, '--noEmit', '--pretty', 'false'],
          cwd: context.root,
          signal,
          timeoutMs: 180_000, // a cold project type-check is slow; give it room
        });
      } catch {
        return;
      }
      if (signal.aborted) return;

      const byFile = new Map<string, RawFinding[]>();
      for (const line of run.stdout.split(/\r?\n/)) {
        const match = DIAGNOSTIC.exec(line);
        if (match === null) continue;
        const [, rawFile, lineStr, colStr, level, ruleId, message] = match;
        if (
          rawFile === undefined ||
          lineStr === undefined ||
          colStr === undefined ||
          ruleId === undefined ||
          message === undefined
        ) {
          continue;
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

      yield* groundByFile('tsc', context, byFile, signal);
    },
  };
}
