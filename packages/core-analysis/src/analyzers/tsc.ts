import type { Finding } from '@fixora/shared-types';

import type { Analyzer, AnalysisTarget } from '../analyzer.js';
import { runTool } from '../process/run-tool.js';
import { parseStructure } from '../structure.js';
import { resolveNodeTool } from '../tools/resolve.js';

import { createGrounder, type AdapterDeps, type RawFinding } from './support.js';

/**
 * The tsc adapter (TypeScript type errors, ADR-025). Unlike eslint/ruff, the type-checker is
 * inherently *project-wide* — it needs the whole program to resolve a type — so it runs `tsc
 * --noEmit` over the workspace's own tsconfig and we keep the diagnostics that land in the target
 * file. That redundancy across files is what the incremental cache (keyed by content + tool version +
 * config) exists to absorb.
 */

// `file(line,col): error TSxxxx: message` — the `--pretty false` diagnostic line.
const DIAGNOSTIC = /^(.+?)\((\d+),(\d+)\):\s+(error|warning)\s+(TS\d+):\s+(.*)$/;

function toPosix(path: string): string {
  return path.replace(/\\/g, '/');
}

export function createTscAnalyzer(deps: AdapterDeps = {}): Analyzer {
  const runner = deps.runner ?? runTool;
  const resolveTool =
    deps.resolveTool ??
    ((t: AnalysisTarget): ReturnType<typeof resolveNodeTool> =>
      resolveNodeTool(t.workspaceRoot, 'typescript', 'tsc'));
  return {
    id: 'tsc',

    supports(language, workspace) {
      return language === 'typescript' && workspace.tools.has('tsc');
    },

    async *analyze(target: AnalysisTarget, signal: AbortSignal): AsyncIterable<Finding> {
      const tool = resolveTool(target);
      if (tool === null) return;

      let run;
      try {
        run = await runner({
          command: tool.command,
          args: [...tool.args, '--noEmit', '--pretty', 'false'],
          cwd: target.workspaceRoot,
          signal,
          timeoutMs: 120_000, // a cold project type-check is slow; give it room
        });
      } catch {
        return;
      }

      const { symbols } = await parseStructure(target.language, target.source, target.file);
      const grounder = createGrounder('tsc', target, symbols);
      const wantRel = target.file;
      const wantAbs = toPosix(target.absPath);

      for (const line of run.stdout.split(/\r?\n/)) {
        if (signal.aborted) return;
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
        const file = toPosix(rawFile);
        if (file !== wantRel && file !== wantAbs && !file.endsWith(`/${wantRel}`)) continue;
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
