import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { delimiter, dirname, join } from 'node:path';

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
  /** Extra environment the child needs. Merged over the parent's env by the runner. */
  env?: Readonly<Record<string, string>> | undefined;
}

/**
 * Running a Node script through `process.execPath` assumes that executable *is* Node. Inside
 * Electron it is not: `process.execPath` is `electron.exe`, and `electron.exe script.js` boots a
 * full Electron app rather than a Node process. The script still runs — ESLint even writes correct
 * JSON to stdout — but the Electron event loop has no reason to end, so the child never exits and
 * is only reclaimed by the runner's 30s SIGKILL. Analysis therefore returned the RIGHT findings
 * roughly 31 seconds late, which reads as "the analyzer found nothing" to anyone who stops waiting.
 *
 * `ELECTRON_RUN_AS_NODE=1` is Electron's supported switch for exactly this: the binary behaves as
 * plain Node and exits when the script does. Measured on the sample that exposed it: 9.9s -> 3.0s
 * from a shell, and 30s-until-killed -> ~1.2s from inside the analysis utility process, with
 * byte-identical output.
 *
 * Set only when the host really is Electron, so a plain-Node host (tests, the benchmark CLI) spawns
 * exactly as before.
 */
function nodeChildEnv(): Readonly<Record<string, string>> | undefined {
  return process.versions['electron'] === undefined ? undefined : { ELECTRON_RUN_AS_NODE: '1' };
}

/** Resolve a Node package's executable to `node <bin.js>`, from the workspace's own install. */
export function resolveNodeTool(
  workspaceRoot: string,
  pkg: string,
  binName: string = pkg,
): ResolvedTool | null {
  // Run through the same Node that hosts the engine — no reliance on `node` being on PATH.
  return readBinFrom(join(workspaceRoot, 'node_modules', pkg, 'package.json'), binName);
}

/**
 * Resolve a Node tool from **Fixora's own** install rather than the workspace's — tier 2 of the
 * hybrid engine.
 *
 * ADR-007 says we run the user's tools, never a bundled copy that would argue with their CI. That
 * rationale is about *contradiction*: a repo pinned to ESLint 8 with its own rules must not be
 * second-guessed by a different ESLint shipping different opinions. It says nothing about a folder
 * that has no ESLint at all — there is no CI there to contradict, and the alternative is what the
 * engine did before this existed: analyze a plain JavaScript folder and report nothing.
 *
 * So the order is strict and the fallback is *only* reached when tier 1 finds nothing. A workspace
 * with its own tool never sees this path.
 */
export function resolveBundledNodeTool(
  pkg: string,
  binName: string = pkg,
  resolver: (specifier: string) => string = defaultResolve,
): ResolvedTool | null {
  let pkgJsonPath: string;
  try {
    pkgJsonPath = resolver(`${pkg}/package.json`);
  } catch {
    // Not installed alongside the engine. Callers treat this exactly like an absent workspace tool.
    return null;
  }
  return readBinFrom(pkgJsonPath, binName);
}

function defaultResolve(specifier: string): string {
  // `createRequire` against this module: under pnpm's isolated linker the bundled tool is a real
  // dependency of core-analysis, so it resolves inside the package's own nested node_modules — which
  // is also what packaging unpacks from the asar.
  return createRequire(import.meta.url).resolve(specifier);
}

/** Shared by both tiers: read a package manifest and turn its `bin` entry into a runnable command. */
function readBinFrom(pkgJsonPath: string, binName: string): ResolvedTool | null {
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
  const binPath = join(dirname(pkgJsonPath), rel);
  if (!existsSync(binPath)) return null;
  return { command: process.execPath, args: [binPath], env: nodeChildEnv() };
}

/**
 * Resolve a native binary vendored into this package — tier 2 for tools that are not npm packages.
 *
 * Ruff is the first: it ships as a platform-specific executable from Astral's GitHub releases, not
 * from npm, so `resolveBundledNodeTool` (which reads a package manifest's `bin`) does not apply. The
 * binary is placed under `vendor/` at build time by `scripts/vendor-ruff.mjs`, after its SHA256 has
 * been verified against a checksum committed in that script.
 *
 * Once packaged this path lands inside `app.asar.unpacked` — a native executable cannot be spawned
 * from inside an asar, which is the same constraint that already governs the tree-sitter WASM.
 */
export function resolveBundledBinary(
  relativePath: string,
  resolver: (specifier: string) => string = defaultResolve,
): ResolvedTool | null {
  let packageJson: string;
  try {
    packageJson = resolver('@fixora/core-analysis/package.json');
  } catch {
    return null;
  }
  const binary = join(dirname(packageJson), relativePath);
  // Absent means the vendor step has not run. Callers treat that exactly like a missing tool rather
  // than failing: a developer who has not vendored still gets tier 1.
  return existsSync(binary) ? { command: binary, args: [] } : null;
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
