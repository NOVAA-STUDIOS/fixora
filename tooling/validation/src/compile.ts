import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  resolveNodeTool,
  resolvePathTool,
  runTool,
  type AnalysisFile,
} from '@fixora/core-analysis';

import type { CompileKind } from './projects.js';
import type { StageResult } from './types.js';

/**
 * The compile/type-check stage — "when applicable". Every kind resolves to a REAL invocation of a REAL
 * compiler, or reports `ran: false` with the reason it could not run (no compiler on this machine, no
 * compiler for this language). It is never scored as a pass when it did not actually run, and it never
 * fabricates a result. `toolRoot` is the directory whose node_modules holds the harness's own tsc.
 */

const COMPILE_TIMEOUT_MS = 180_000;
const NO_ABORT = new AbortController().signal;

function notRun(detail: string): StageResult {
  return { ran: false, ok: false, detail };
}

async function nodeCheck(files: AnalysisFile[]): Promise<StageResult> {
  const js = files.filter((f) => f.language === 'javascript');
  if (js.length === 0) return notRun('no JavaScript files to syntax-check');
  for (const f of js) {
    // `process.execPath` is the Node that runs this harness (tsx → node), so --check is a real parse.
    const run = await runTool({
      command: process.execPath,
      args: ['--check', f.absPath],
      cwd: process.cwd(),
      signal: NO_ABORT,
      timeoutMs: COMPILE_TIMEOUT_MS,
    });
    if (run.code !== 0) {
      return {
        ran: true,
        ok: false,
        detail: `node --check failed on ${f.file}: ${run.stderr.trim()}`,
      };
    }
  }
  return { ran: true, ok: true, detail: `node --check passed on ${String(js.length)} file(s)` };
}

async function tsc(root: string, toolRoot: string): Promise<StageResult> {
  const tool = resolveNodeTool(toolRoot, 'typescript', 'tsc');
  if (tool === null) return notRun('tsc could not be resolved from the harness install');
  const run = await runTool({
    command: tool.command,
    args: [...tool.args, '--noEmit', '--pretty', 'false'],
    cwd: root,
    env: tool.env,
    signal: NO_ABORT,
    timeoutMs: COMPILE_TIMEOUT_MS,
  });
  // tsc exits non-zero when it prints diagnostics. A clean type-check is exit 0 with no diagnostics.
  if (run.code === 0) return { ran: true, ok: true, detail: 'tsc --noEmit: no type errors' };
  const firstLine =
    run.stdout.split(/\r?\n/).find((l) => /error TS\d+/.test(l)) ?? run.stderr.trim();
  return { ran: true, ok: false, detail: `tsc --noEmit reported errors: ${firstLine}` };
}

async function pyCompile(files: AnalysisFile[]): Promise<StageResult> {
  const py = files.filter((f) => f.language === 'python');
  if (py.length === 0) return notRun('no Python files to compile');
  const tool = resolvePathTool('python') ?? resolvePathTool('python3');
  if (tool === null) return notRun('python is not on PATH, so a syntax check cannot run');
  // A real syntax check that writes NOTHING: the builtin `compile()` parses the source to a code
  // object in memory and raises SyntaxError (→ non-zero exit) on a malformed file. `py_compile` was
  // rejected here because it insists on writing a .pyc, which pollutes the corpus and, on Windows,
  // even errors when pointed at `nul` (FileExistsError: nul is a non-regular file).
  const script = 'import sys; compile(open(sys.argv[1],"rb").read(), sys.argv[1], "exec")';
  for (const f of py) {
    const run = await runTool({
      command: tool.command,
      args: [...tool.args, '-c', script, f.absPath],
      cwd: process.cwd(),
      signal: NO_ABORT,
      timeoutMs: COMPILE_TIMEOUT_MS,
    });
    if (run.code !== 0) {
      return {
        ran: true,
        ok: false,
        detail: `python syntax check failed on ${f.file}: ${run.stderr.trim()}`,
      };
    }
  }
  return {
    ran: true,
    ok: true,
    detail: `python syntax check passed on ${String(py.length)} file(s)`,
  };
}

function jsonParse(root: string, files: AnalysisFile[]): StageResult {
  const jsons = files.filter((f) => f.language === 'json');
  if (jsons.length === 0) return notRun('no JSON files to parse');
  for (const f of jsons) {
    try {
      JSON.parse(readFileSync(join(root, f.file), 'utf8'));
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return { ran: true, ok: false, detail: `JSON.parse failed on ${f.file}: ${detail}` };
    }
  }
  return { ran: true, ok: true, detail: `JSON.parse succeeded on ${String(jsons.length)} file(s)` };
}

/** Run the project's declared compile kind against the (possibly patched) files under `root`. */
export async function compileProject(input: {
  kind: CompileKind;
  root: string;
  toolRoot: string;
  files: AnalysisFile[];
}): Promise<StageResult> {
  switch (input.kind) {
    case 'node-check':
      return nodeCheck(input.files);
    case 'tsc':
      return tsc(input.root, input.toolRoot);
    case 'py-compile':
      return pyCompile(input.files);
    case 'json-parse':
      return jsonParse(input.root, input.files);
    case 'none':
      return notRun('no compiler applies to this language');
  }
}
