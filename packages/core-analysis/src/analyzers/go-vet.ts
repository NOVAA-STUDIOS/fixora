import { dirname } from 'node:path';

import type { Finding } from '@fixora/shared-types';

import type { Analyzer, AnalysisTarget } from '../analyzer.js';
import { runTool } from '../process/run-tool.js';
import { parseStructure } from '../structure.js';
import { resolvePathTool } from '../tools/resolve.js';

import { createGrounder, type AdapterDeps, type RawFinding } from './support.js';

/**
 * The go vet adapter (Go, ADR-025). Go's tooling is the cleanest of the three — one official
 * toolchain — but it works on *packages*, not single files, so we vet the file's package and keep the
 * diagnostics that land in the target file. `-json` gives us the analyzer name (printf, shadow, …) as
 * a real rule id, which text output does not.
 */

/** `go vet -json` shape: { pkgPath: { analyzerName: [{ posn, message }] } }. */
type GoVetJson = Record<string, Record<string, { posn: string; message: string }[]>>;

/** Parse a `file:line:col` position; anchored to the end so a Windows `C:\` drive colon is safe. */
function parsePosn(posn: string): { file: string; line: number; col: number } | null {
  const match = /^(.*):(\d+):(\d+)$/.exec(posn);
  if (match === null) return null;
  const [, file, lineStr, colStr] = match;
  if (file === undefined || lineStr === undefined || colStr === undefined) return null;
  return { file, line: Number(lineStr), col: Number(colStr) };
}

function toPosix(path: string): string {
  return path.replace(/\\/g, '/');
}

export function createGoVetAnalyzer(deps: AdapterDeps = {}): Analyzer {
  const runner = deps.runner ?? runTool;
  const resolveTool =
    deps.resolveTool ?? ((): ReturnType<typeof resolvePathTool> => resolvePathTool('go'));
  return {
    id: 'go-vet',

    supports(language, workspace) {
      return language === 'go' && workspace.tools.has('go');
    },

    async *analyze(target: AnalysisTarget, signal: AbortSignal): AsyncIterable<Finding> {
      const tool = resolveTool(target);
      if (tool === null) return;

      // Vet the package that contains the file. go vet cannot read stdin, so it sees the file on disk.
      const pkgDir = dirname(target.absPath);
      let run;
      try {
        run = await runner({
          command: tool.command,
          args: [...tool.args, 'vet', '-json', pkgDir],
          cwd: target.workspaceRoot,
          signal,
        });
      } catch {
        return;
      }

      // go vet prints the JSON report to stderr; a build failure produces non-JSON there instead.
      const payload = run.stderr.trim() || run.stdout.trim();
      const start = payload.indexOf('{');
      if (start === -1) return;
      let report: GoVetJson;
      try {
        report = JSON.parse(payload.slice(start)) as GoVetJson;
      } catch {
        return;
      }

      const { symbols } = await parseStructure(target.language, target.source, target.file);
      const grounder = createGrounder('go-vet', target, symbols);
      const wantAbs = toPosix(target.absPath);
      const wantRel = target.file;

      for (const analyzers of Object.values(report)) {
        for (const [analyzerName, diagnostics] of Object.entries(analyzers)) {
          for (const diagnostic of diagnostics) {
            if (signal.aborted) return;
            const pos = parsePosn(diagnostic.posn);
            if (pos === null) continue;
            const file = toPosix(pos.file);
            if (file !== wantAbs && !file.endsWith(`/${wantRel}`)) continue; // a different file in the package
            const raw: RawFinding = {
              ruleId: analyzerName,
              severity: 'warning',
              category: 'correctness',
              message: diagnostic.message,
              startLine: pos.line,
              startCol: pos.col,
              fixable: false,
              toolOutput: diagnostic,
            };
            yield grounder.ground(raw);
          }
        }
      }
    },
  };
}
