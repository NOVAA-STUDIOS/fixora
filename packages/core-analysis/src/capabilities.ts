import type { WorkspaceCapabilities } from './analyzer.js';
import { runTool, type ToolRunner } from './process/run-tool.js';
import {
  resolveBundledNodeTool,
  resolveNodeTool,
  resolvePathTool,
  type ResolvedTool,
} from './tools/resolve.js';

/**
 * What tools does *this* workspace have (TDD §5.2, ADR-007)? We run the user's own eslint, tsc,
 * ruff, mypy, go vet, semgrep — never a bundled copy that would argue with their CI — so first we
 * find out which are present. Node tools come from the workspace's `node_modules`; the rest from
 * PATH. Versions feed the incremental cache key (`content + tool_version + config`).
 */

interface ToolSpec {
  id: string;
  resolve: (root: string) => ResolvedTool | null;
  /** Fixora's own copy, used only when `resolve` finds nothing. Absent = no fallback exists. */
  fallback?: () => ResolvedTool | null;
  versionArgs: readonly string[];
}

const TOOL_SPECS: readonly ToolSpec[] = [
  {
    id: 'eslint',
    resolve: (r) => resolveNodeTool(r, 'eslint'),
    // Tier 2: only consulted when the workspace has none of its own.
    fallback: () => resolveBundledNodeTool('eslint'),
    versionArgs: ['--version'],
  },
  {
    id: 'tsc',
    resolve: (r) => resolveNodeTool(r, 'typescript', 'tsc'),
    fallback: () => resolveBundledNodeTool('typescript', 'tsc'),
    versionArgs: ['--version'],
  },
  { id: 'ruff', resolve: () => resolvePathTool('ruff'), versionArgs: ['--version'] },
  { id: 'mypy', resolve: () => resolvePathTool('mypy'), versionArgs: ['--version'] },
  { id: 'go', resolve: () => resolvePathTool('go'), versionArgs: ['version'] },
  { id: 'semgrep', resolve: () => resolvePathTool('semgrep'), versionArgs: ['--version'] },
];

/** Detect the tools available in `root`. The runner is injectable so this is unit-testable offline. */
export async function detectCapabilities(
  root: string,
  runner: ToolRunner = runTool,
): Promise<WorkspaceCapabilities> {
  const tools = new Set<string>();
  const versions = new Map<string, string>();
  const bundled = new Set<string>();

  await Promise.all(
    TOOL_SPECS.map(async (spec) => {
      // Tier 1 then tier 2, in that order and never the reverse: a workspace with its own tool must
      // never be analyzed by ours.
      let resolved = spec.resolve(root);
      if (resolved === null && spec.fallback !== undefined) {
        resolved = spec.fallback();
        if (resolved !== null) bundled.add(spec.id);
      }
      if (resolved === null) return;
      tools.add(spec.id);
      try {
        const run = await runner({
          command: resolved.command,
          args: [...resolved.args, ...spec.versionArgs],
          cwd: root,
          signal: new AbortController().signal,
          timeoutMs: 5000,
        });
        const line = (run.stdout || run.stderr).trim().split(/\r?\n/)[0]?.trim();
        if (line !== undefined && line !== '') versions.set(spec.id, line);
      } catch {
        // A version probe failing does not mean the tool is absent — presence is the resolve() check.
      }
    }),
  );

  return { root, tools, versions, bundled };
}
