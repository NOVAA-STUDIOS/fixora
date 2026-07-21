import type { Language } from '@fixora/shared-types';

import { RUFF_VENDOR_PATH } from '../analyzers/ruff.js';
import { runTool, type ToolRunner } from '../process/run-tool.js';
import {
  resolveBundledBinary,
  resolveNodeTool,
  resolvePathTool,
  type ResolvedTool,
} from '../tools/resolve.js';

/**
 * The formatter gate (Goals 4 & 9).
 *
 * A repair must be something a formatter can process without erroring — a patch that parses under a
 * lenient grammar but is malformed enough to make the project's own formatter throw is not a patch we
 * apply. "Succeeds" here means exactly that: the formatter runs to completion on the patched file. It
 * does NOT mean the file already matched the formatter's style — a repair is never rejected for
 * cosmetics, only for being un-formattable.
 *
 * The gate runs against the throwaway verification overlay, so an in-place reformat is harmless. When
 * no formatter is available for the language it reports `ran: false` and does not block — a gate that
 * cannot run is honestly absent, never a silent pass dressed up as a real check.
 */

export interface FormatGateResult {
  /** Did a formatter actually run? False when none is available for this language. */
  ran: boolean;
  /** Did it complete without a parse/format error? Meaningless (defaults true) when `ran` is false. */
  ok: boolean;
  /** The formatter used, e.g. 'prettier' or 'ruff format'. */
  formatter?: string;
  /** The formatter's own error output when it failed — shown to the user verbatim, never redacted. */
  message?: string;
}

interface ResolvedFormatter {
  name: string;
  tool: ResolvedTool;
  /** Build the argv that formats `absFile` in place (the overlay copy). */
  args: (absFile: string) => string[];
}

/**
 * Resolve a formatter for a language. Python always has one (Ruff is vendored and formats); JS/TS and
 * the web languages use the workspace's own Prettier when it is installed, and otherwise have none —
 * Fixora does not impose a formatter a project did not choose.
 */
export function resolveFormatter(
  language: Language,
  root: string,
  resolvers: {
    node?: (root: string, pkg: string, bin?: string) => ResolvedTool | null;
    bundled?: (path: string) => ResolvedTool | null;
    path?: (name: string) => ResolvedTool | null;
  } = {},
): ResolvedFormatter | null {
  const node = resolvers.node ?? resolveNodeTool;
  const bundled = resolvers.bundled ?? resolveBundledBinary;
  const path = resolvers.path ?? resolvePathTool;

  if (language === 'python') {
    const tool = path('ruff') ?? bundled(RUFF_VENDOR_PATH);
    return tool === null ? null : { name: 'ruff format', tool, args: (f) => ['format', f] };
  }
  // Prettier covers ts/js and, through the workspace install, json/css/html too.
  if (language === 'typescript' || language === 'javascript') {
    const tool = node(root, 'prettier');
    return tool === null ? null : { name: 'prettier', tool, args: (f) => ['--write', f] };
  }
  return null;
}

/**
 * Run the formatter gate against a file inside the verification overlay. `absFile` must be the overlay
 * copy, not the user's real file — the formatter reformats it in place.
 */
export async function formatGate(input: {
  root: string;
  absFile: string;
  language: Language;
  runner?: ToolRunner;
  resolve?: typeof resolveFormatter;
}): Promise<FormatGateResult> {
  const resolve = input.resolve ?? resolveFormatter;
  const runner = input.runner ?? runTool;
  const formatter = resolve(input.language, input.root);
  if (formatter === null) return { ran: false, ok: true };

  let run;
  try {
    run = await runner({
      command: formatter.tool.command,
      args: [...formatter.tool.args, ...formatter.args(input.absFile)],
      env: formatter.tool.env,
      cwd: input.root,
      signal: new AbortController().signal,
      timeoutMs: 30_000,
    });
  } catch {
    // Could not even spawn the formatter — treat as not-run rather than a failure of the patch.
    return { ran: false, ok: true, formatter: formatter.name };
  }

  if (run.code === 0) return { ran: true, ok: true, formatter: formatter.name };
  // Non-zero: the formatter refused the file. Its stderr is the exact diagnostic (line + reason).
  const message = (run.stderr || run.stdout).trim().split(/\r?\n/).slice(0, 4).join('\n');
  return { ran: true, ok: false, formatter: formatter.name, message };
}
