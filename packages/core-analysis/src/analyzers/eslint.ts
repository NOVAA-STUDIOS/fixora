import { relative, sep } from 'node:path';

import type { Category } from '@fixora/shared-types';

import type { Analyzer } from '../analyzer.js';
import { runTool } from '../process/run-tool.js';
import { resolveBundledNodeTool, resolveNodeTool } from '../tools/resolve.js';

import { writeFallbackEslintConfig } from './fallback-eslint-config.js';
import { groundByFile, type AdapterDeps, type RawFinding } from './support.js';

/**
 * The ESLint adapter — the flagship for the TS/JS market (ADR-025). It runs the **workspace's own**
 * eslint with the **workspace's own config**, **once** over the whole directory (not once per file —
 * that would spawn hundreds of node processes), and normalises the JSON to grounded `Finding`s.
 * Because it is the user's eslint at their version with their rules, our findings match their CI.
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
  filePath: string;
  messages: EslintMessage[];
}

/** ESLint has no category taxonomy; heuristic — an error is treated as correctness, a warning as style. */
function categoryFor(severity: 1 | 2): Category {
  return severity === 2 ? 'correctness' : 'style';
}

function toRelPosix(root: string, absPath: string): string {
  return relative(root, absPath).split(sep).join('/');
}

export function createEslintAnalyzer(deps: AdapterDeps = {}): Analyzer {
  const runner = deps.runner ?? runTool;
  const resolveTool =
    deps.resolveTool ??
    // Tier 1 then tier 2 — the same order capabilities used to decide the tool was present at all.
    ((root: string) => resolveNodeTool(root, 'eslint') ?? resolveBundledNodeTool('eslint'));

  return {
    id: 'eslint',

    supports(capabilities) {
      return capabilities.tools.has('eslint');
    },

    async *run(context, signal) {
      const hasJsTs = context.files.some(
        (f) => f.language === 'typescript' || f.language === 'javascript',
      );
      if (!hasJsTs) return;
      const tool = resolveTool(context.root);
      if (tool === null) return;

      // Tier 2: our ESLint against a workspace that, by definition, has no config for it. Point it at
      // our own rule set and stop it walking up to some unrelated config outside the project.
      const isBundled = context.capabilities.bundled?.has('eslint') === true;
      let configArgs: string[] = [];
      if (isBundled) {
        const config = writeFallbackEslintConfig();
        // No config means our plugins are missing; running anyway would report parse errors as if
        // they were the user's bugs.
        if (config === null) return;
        configArgs = ['--no-config-lookup', '--config', config];
      }

      let run;
      try {
        run = await runner({
          command: tool.command,
          args: [...tool.args, ...configArgs, '--format', 'json', '.'],
          cwd: context.root,
          signal,
        });
      } catch {
        return; // aborted or failed to spawn — no findings, never throw
      }
      if (signal.aborted || run.stdout.trim() === '') return;

      let results: EslintFileResult[];
      try {
        results = JSON.parse(run.stdout) as EslintFileResult[];
      } catch {
        return; // not JSON (a crash or config error) — degrade to nothing
      }

      const byFile = new Map<string, RawFinding[]>();
      for (const fileResult of results) {
        const file = toRelPosix(context.root, fileResult.filePath);
        for (const message of fileResult.messages) {
          if (message.ruleId === null) continue; // parse/config errors, not lint findings
          const raw: RawFinding = {
            ruleId: message.ruleId,
            severity: message.severity === 2 ? 'error' : 'warning',
            category: categoryFor(message.severity === 2 ? 2 : 1),
            message: message.message,
            startLine: message.line,
            startCol: message.column,
            ...(message.endLine !== undefined
              ? { endLine: message.endLine, endCol: message.endColumn }
              : {}),
            fixable: message.fix !== undefined,
            toolOutput: message,
          };
          const list = byFile.get(file);
          if (list === undefined) byFile.set(file, [raw]);
          else list.push(raw);
        }
      }

      yield* groundByFile('eslint', context, byFile, signal);
    },
  };
}
