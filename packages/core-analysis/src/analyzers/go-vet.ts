import { relative, sep } from 'node:path';

import type { Analyzer } from '../analyzer.js';
import { runTool } from '../process/run-tool.js';
import { resolvePathTool } from '../tools/resolve.js';

import { groundByFile, type AdapterDeps, type RawFinding } from './support.js';

/**
 * The go vet adapter (Go, ADR-025). Go's tooling works on packages, and `go vet ./...` vets every
 * package in the module **once** — so workspace-scope is the natural shape here. `-json` gives us the
 * analyzer name (printf, shadow, …) as a real rule id, which text output does not.
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

function toRelPosix(root: string, file: string): string {
  return relative(root, file).split(sep).join('/');
}

export function createGoVetAnalyzer(deps: AdapterDeps = {}): Analyzer {
  const runner = deps.runner ?? runTool;
  const resolveTool = deps.resolveTool ?? (() => resolvePathTool('go'));

  return {
    id: 'go-vet',

    supports(capabilities) {
      return capabilities.tools.has('go');
    },

    async *run(context, signal) {
      if (!context.files.some((f) => f.language === 'go')) return;
      const tool = resolveTool(context.root);
      if (tool === null) return;

      let run;
      try {
        run = await runner({
          command: tool.command,
          env: tool.env,
          args: [...tool.args, 'vet', '-json', './...'],
          cwd: context.root,
          signal,
          timeoutMs: 180_000,
        });
      } catch {
        return;
      }
      if (signal.aborted) return;

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

      const byFile = new Map<string, RawFinding[]>();
      for (const analyzers of Object.values(report)) {
        for (const [analyzerName, diagnostics] of Object.entries(analyzers)) {
          for (const diagnostic of diagnostics) {
            const pos = parsePosn(diagnostic.posn);
            if (pos === null) continue;
            const file = toRelPosix(context.root, pos.file);
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
            const list = byFile.get(file);
            if (list === undefined) byFile.set(file, [raw]);
            else list.push(raw);
          }
        }
      }

      yield* groundByFile('go-vet', context, byFile, signal);
    },
  };
}
