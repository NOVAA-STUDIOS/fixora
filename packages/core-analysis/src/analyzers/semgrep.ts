import { existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import type { Category, Severity } from '@fixora/shared-types';

import type { Analyzer, WorkspaceCapabilities } from '../analyzer.js';
import { runTool } from '../process/run-tool.js';
import { resolvePathTool } from '../tools/resolve.js';

import { groundByFile, reportToolTimeout, type AdapterDeps, type RawFinding } from './support.js';

/**
 * The Semgrep adapter — cross-language security (ADR-025). Semgrep needs a ruleset; `--config auto`
 * would fetch rules over the network (offline must work), so this runs **only when the workspace
 * ships its own Semgrep config** — the ruleset the user's CI uses (ADR-007). One scan over the whole
 * workspace.
 */

const CONFIG_FILES = ['.semgrep.yml', '.semgrep.yaml', 'semgrep.yml', 'semgrep.yaml'];

function semgrepConfig(root: string): string | null {
  for (const name of CONFIG_FILES) {
    const path = join(root, name);
    if (existsSync(path)) return path;
  }
  return null;
}

interface SemgrepPoint {
  line: number;
  col: number;
}
interface SemgrepResult {
  check_id: string;
  path: string;
  start: SemgrepPoint;
  end?: SemgrepPoint;
  extra?: {
    message?: string;
    severity?: string;
    fix?: unknown;
    metadata?: { category?: string };
  };
}

const OUR_CATEGORIES = new Set<Category>([
  'correctness',
  'security',
  'performance',
  'maintainability',
  'style',
]);

function categoryFor(result: SemgrepResult): Category {
  const meta = result.extra?.metadata?.category;
  return meta !== undefined && OUR_CATEGORIES.has(meta as Category)
    ? (meta as Category)
    : 'security';
}

function severityFor(raw: string | undefined): Severity {
  if (raw === 'ERROR') return 'error';
  if (raw === 'INFO') return 'info';
  return 'warning';
}

function toRelPosix(root: string, file: string): string {
  const rel = file.startsWith('/') || file.includes(':\\') ? relative(root, file) : file;
  return rel.split(sep).join('/');
}

export function createSemgrepAnalyzer(deps: AdapterDeps = {}): Analyzer {
  const runner = deps.runner ?? runTool;
  const resolveTool = deps.resolveTool ?? (() => resolvePathTool('semgrep'));

  return {
    id: 'semgrep',

    supports(capabilities: WorkspaceCapabilities) {
      return capabilities.tools.has('semgrep') && semgrepConfig(capabilities.root) !== null;
    },

    async *run(context, signal) {
      const config = semgrepConfig(context.root);
      const tool = resolveTool(context.root);
      if (config === null || tool === null) return;

      let run;
      try {
        run = await runner({
          command: tool.command,
          env: tool.env,
          args: [...tool.args, 'scan', '--json', '--quiet', '--config', config, '.'],
          cwd: context.root,
          signal,
          timeoutMs: 180_000,
        });
      } catch {
        return;
      }
      if (reportToolTimeout(context, 'semgrep', tool.command, run)) return;
      if (signal.aborted || run.stdout.trim() === '') return;

      let report: { results?: SemgrepResult[] };
      try {
        report = JSON.parse(run.stdout) as { results?: SemgrepResult[] };
      } catch {
        return;
      }

      const byFile = new Map<string, RawFinding[]>();
      for (const result of report.results ?? []) {
        const file = toRelPosix(context.root, result.path);
        const raw: RawFinding = {
          ruleId: result.check_id,
          severity: severityFor(result.extra?.severity),
          category: categoryFor(result),
          message: result.extra?.message ?? result.check_id,
          startLine: result.start.line,
          startCol: result.start.col,
          ...(result.end !== undefined ? { endLine: result.end.line, endCol: result.end.col } : {}),
          fixable: result.extra?.fix !== undefined && result.extra.fix !== null,
          toolOutput: result,
        };
        const list = byFile.get(file);
        if (list === undefined) byFile.set(file, [raw]);
        else list.push(raw);
      }

      yield* groundByFile('semgrep', context, byFile, signal);
    },
  };
}
