import { existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import type { Analyzer } from '../analyzer.js';
import { runTool } from '../process/run-tool.js';
import { resolveBundledNodeTool, resolveNodeTool } from '../tools/resolve.js';

import { FALLBACK_TSC_FLAGS } from './fallback-tsc-flags.js';
import { groundByFile, reportToolTimeout, type AdapterDeps, type RawFinding } from './support.js';

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

/**
 * With no tsconfig, tsc has no file list — so tier 2 passes the workspace's own files explicitly.
 * Relative paths keep the command line short and the diagnostics reported the way tier 1 reports
 * them, which is what the grounding step downstream already expects.
 */
function filesToCheck(
  context: { files: readonly { file: string; language: string }[] },
  relevant: (f: { language: string }) => boolean,
): string[] {
  return context.files.filter(relevant).map((f) => f.file);
}

/**
 * Diagnostics that mean "dependencies are not installed here" rather than "this code is wrong".
 * Suppressed only for the bundled tier — see the note at the use site.
 */
const MODULE_RESOLUTION_CODES = new Set([
  'TS2307', // Cannot find module 'x' or its corresponding type declarations
  'TS2875', // This JSX tag requires the module path 'react/jsx-runtime' to exist
  'TS7016', // Could not find a declaration file for module 'x'
  'TS2688', // Cannot find type definition file for 'x'
]);

export function createTscAnalyzer(deps: AdapterDeps = {}): Analyzer {
  const runner = deps.runner ?? runTool;
  const resolveTool =
    deps.resolveTool ??
    ((root: string) =>
      resolveNodeTool(root, 'typescript', 'tsc') ?? resolveBundledNodeTool('typescript', 'tsc'));

  return {
    id: 'tsc',

    supports(capabilities) {
      return capabilities.tools.has('tsc');
    },

    async *run(context, signal) {
      // The invocation strategy keys on whether the PROJECT is configured (a tsconfig exists), not on
      // which tsc binary we resolved. Conflating the two was the flagship accuracy bug: a project with
      // a tsconfig but no local tsc install used the bundled binary, which took the "config-less"
      // branch and passed explicit files. In TypeScript 6+ passing files while a tsconfig is present
      // is a hard error (TS5112) that aborts the check, so every real diagnostic — a plain TS2304
      // "cannot find name" among them — was silently dropped.
      const hasTsconfig = existsSync(join(context.root, 'tsconfig.json'));
      // Deps not installed: every import becomes "cannot find module", which is a report about the
      // install, not the code. That noise is suppressed on absence of node_modules — in either mode,
      // since a configured project whose deps are not installed hits it just as a bare folder does.
      const hasNodeModules = existsSync(join(context.root, 'node_modules'));

      // A configured project is checked in project mode, where the tsconfig's own include/checkJs
      // decide scope. A config-less folder we drive ourselves, and there we also opt plain JS in.
      const relevant = hasTsconfig
        ? (f: { language: string }) => f.language === 'typescript'
        : (f: { language: string }) => f.language === 'typescript' || f.language === 'javascript';
      if (!context.files.some(relevant)) return;
      const tool = resolveTool(context.root);
      if (tool === null) return;

      let run;
      try {
        run = await runner({
          command: tool.command,
          env: tool.env,
          // Project mode obeys the workspace's tsconfig (the ADR-007 guarantee) and passes NO files —
          // that is what avoids TS5112. Fallback mode has no tsconfig, so it names its own narrow,
          // high-confidence flags and lists the files to check.
          args: hasTsconfig
            ? [...tool.args, '--noEmit', '--pretty', 'false']
            : [...tool.args, ...FALLBACK_TSC_FLAGS, ...filesToCheck(context, relevant)],
          cwd: context.root,
          signal,
          timeoutMs: 180_000, // a cold project type-check is slow; give it room
        });
      } catch {
        return;
      }
      if (reportToolTimeout(context, 'tsc', tool.command, run)) return;
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
        // Tier 2 runs against a folder that usually has no node_modules, so every import produces a
        // "cannot find module" diagnostic. That is a report about the user's *install*, not their
        // code — it is noise of exactly the kind that makes an analyzer untrustworthy, and it would
        // be the loudest thing on screen in any real project. Tier 1 keeps reporting it, because
        // there the project genuinely is configured and a missing module is a real problem.
        if (!hasNodeModules && MODULE_RESOLUTION_CODES.has(ruleId)) continue;

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
