import { existsSync, readFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';

/**
 * Locating the workspace's own tools, cross-platform, without a shell. Two kinds:
 *
 *  - **Node tools** (ESLint, tsc) live in the workspace's `node_modules`. We resolve the package's
 *    `bin` JS and run it as `node <bin.js>`, which sidesteps the Windows `.cmd` shim (that would
 *    otherwise force `shell: true` and re-open command injection).
 *  - **PATH tools** (go, ruff, mypy, semgrep) are found by a `which`-style scan of `PATH` + `PATHEXT`.
 *
 * A resolved tool is a `command` + fixed `args` prefix — an array, never a string, so nothing in a
 * path is ever shell-interpreted.
 */

export interface ResolvedTool {
  command: string;
  args: readonly string[];
}

/** Resolve a Node package's executable to `node <bin.js>`, from the workspace's own install. */
export function resolveNodeTool(
  workspaceRoot: string,
  pkg: string,
  binName: string = pkg,
): ResolvedTool | null {
  const pkgJsonPath = join(workspaceRoot, 'node_modules', pkg, 'package.json');
  if (!existsSync(pkgJsonPath)) return null;
  let manifest: unknown;
  try {
    manifest = JSON.parse(readFileSync(pkgJsonPath, 'utf8'));
  } catch {
    return null;
  }
  const bin = (manifest as { bin?: unknown }).bin;
  let rel: string | undefined;
  if (typeof bin === 'string') rel = bin;
  else if (bin !== null && typeof bin === 'object') {
    const value = (bin as Record<string, unknown>)[binName];
    if (typeof value === 'string') rel = value;
  }
  if (rel === undefined) return null;
  const binPath = join(workspaceRoot, 'node_modules', pkg, rel);
  if (!existsSync(binPath)) return null;
  // Run through the same Node that hosts the engine — no reliance on `node` being on PATH.
  return { command: process.execPath, args: [binPath] };
}

/** A `which`: the absolute path of an executable on PATH, honouring PATHEXT on Windows. */
export function which(name: string): string | null {
  const pathVar = process.env['PATH'] ?? '';
  const exts =
    process.platform === 'win32'
      ? (process.env['PATHEXT'] ?? '.EXE;.CMD;.BAT').split(';').filter(Boolean)
      : [''];
  for (const dir of pathVar.split(delimiter)) {
    if (dir === '') continue;
    for (const ext of exts) {
      const candidate = join(dir, name + ext);
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

/** Resolve a PATH tool (e.g. `go`, `ruff`) to a runnable command, or null if absent. */
export function resolvePathTool(name: string): ResolvedTool | null {
  const found = which(name);
  return found === null ? null : { command: found, args: [] };
}
