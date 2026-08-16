import { relative, sep } from 'node:path';

import type { Category } from '@fixora/shared-types';

import type { Analyzer } from '../analyzer.js';
import { runTool } from '../process/run-tool.js';
import { resolveBundledBinary, resolvePathTool } from '../tools/resolve.js';

import { groundByFile, reportToolTimeout, type AdapterDeps, type RawFinding } from './support.js';

/**
 * The ruff adapter (Python, ADR-025). Runs the workspace's ruff **once** over the directory and
 * normalises its JSON. As with eslint it is the *workspace's* ruff with the *workspace's* config, so
 * findings match the user's CI.
 */

interface RuffPoint {
  row: number;
  column: number;
}
interface RuffEdit {
  content: string;
  location: RuffPoint;
  end_location: RuffPoint;
}
interface RuffFix {
  /** Ruff's own judgement: `safe` fixes preserve behaviour; `unsafe`/`display` may not. */
  applicability?: string;
  edits: RuffEdit[];
  message?: string;
}
interface RuffMessage {
  code: string | null;
  message: string;
  filename: string;
  location: RuffPoint;
  end_location?: RuffPoint;
  fix?: RuffFix | null;
}

/**
 * Ruff reports edit positions as 1-based (row, column); a micro-repair needs character offsets. This
 * converts using the file's own line starts. Columns are treated as character offsets within the line,
 * which is exact for ASCII and the common BMP case; a fix landing past a line's end is rejected by the
 * caller. Returns null if any position is out of range, so a fix we cannot place exactly is dropped
 * rather than misapplied.
 */
function lineStarts(source: string): number[] {
  const starts = [0];
  for (let i = 0; i < source.length; i++) {
    if (source[i] === '\n') starts.push(i + 1);
  }
  return starts;
}
function toOffset(starts: number[], point: RuffPoint, sourceLength: number): number | null {
  const lineStart = starts[point.row - 1];
  if (lineStart === undefined) return null;
  const offset = lineStart + (point.column - 1);
  return offset >= 0 && offset <= sourceLength ? offset : null;
}

function categoryFor(code: string): Category {
  const prefix = code[0];
  if (prefix === 'S') return 'security';
  if (code.startsWith('PLR') || prefix === 'C') return 'maintainability';
  if (prefix === 'E' || prefix === 'W' || prefix === 'D' || prefix === 'Q') return 'style';
  return 'correctness';
}

/**
 * Ruff reports every violation at one level — it has no notion of severity. But an undefined name is a
 * guaranteed `NameError` the instant that line runs, and a syntax error means the file does not run at
 * all; surfacing either at the same level as a stylistic nit makes the Problems severity filter
 * useless and, worse, tells the developer a certain crash is optional. A small, conservative set of
 * codes that are CERTAIN runtime failures or literal syntax errors is raised to `error`. Everything
 * else stays `warning`: over-escalation erodes trust as surely as under-reporting, so when a code is
 * not unambiguously a runtime failure it is left where it was (Goal 6 — severity honesty).
 */
const RUFF_ERROR_CODES = new Set<string>([
  'E999', // syntax error — the file does not parse, so nothing in it runs
  'F821', // undefined name — NameError the moment that line executes
  'F822', // undefined name in `__all__`
  'F823', // local variable referenced before assignment — UnboundLocalError
  'F701', // `break` outside a loop — SyntaxError
  'F702', // `continue` outside a loop — SyntaxError
  'F704', // `yield`/`await` outside a function — SyntaxError
  'F706', // `return` outside a function — SyntaxError
  'F707', // `except` after a bare `except` — the handler is unreachable
]);

function severityFor(code: string): 'error' | 'warning' {
  return RUFF_ERROR_CODES.has(code) ? 'error' : 'warning';
}

function toRelPosix(root: string, absPath: string): string {
  return relative(root, absPath).split(sep).join('/');
}

/** Where `scripts/vendor-ruff.mjs` places the verified binary, relative to the package root. */
export const RUFF_VENDOR_PATH =
  process.platform === 'win32' ? 'vendor/ruff/ruff.exe' : 'vendor/ruff/ruff';

/**
 * The rules the bundled tier selects, per Engineering Spec Section 11: every rule must flag a defect,
 * not a preference.
 *
 * `F` is pyflakes — undefined names, unused imports and variables, f-strings with no placeholders.
 * Provably wrong, never intentional. The `B` rules are hand-picked from flake8-bugbear rather than
 * enabled wholesale, because some bugbear rules are opinionated: B006 (mutable default argument) and
 * B012 are real bugs, B008 and friends are judgement calls.
 *
 * Deliberately absent: `E`/`W` (pycodestyle — line length, whitespace, indentation) and `I` (isort —
 * import order). Ruff's default selection includes `E`, so it must be replaced rather than extended,
 * which is why this is `--select` and not `--extend-select`.
 */
export const FALLBACK_RUFF_RULES = 'F,B006,B012,B018,B020';

export function createRuffAnalyzer(deps: AdapterDeps = {}): Analyzer {
  const runner = deps.runner ?? runTool;
  const resolveTool =
    deps.resolveTool ??
    // Tier 1 then tier 2 — the workspace's own ruff always wins (ADR-007).
    (() => resolvePathTool('ruff') ?? resolveBundledBinary(RUFF_VENDOR_PATH));

  return {
    id: 'ruff',

    supports(capabilities) {
      return capabilities.tools.has('ruff');
    },

    async *run(context, signal) {
      if (!context.files.some((f) => f.language === 'python')) return;
      const isBundled = context.capabilities.bundled?.has('ruff') === true;
      const tool = resolveTool(context.root);
      if (tool === null) return;

      let run;
      try {
        run = await runner({
          command: tool.command,
          env: tool.env,
          // A bundled run has no ruff.toml to obey, so it names its own rule set and refuses to
          // pick up any config it happens to find above the workspace. Tier 1 keeps deferring to the
          // project's own configuration entirely.
          args: isBundled
            ? [
                ...tool.args,
                'check',
                '--no-cache',
                '--isolated',
                '--select',
                FALLBACK_RUFF_RULES,
                '--output-format',
                'json',
                '.',
              ]
            : [...tool.args, 'check', '--output-format', 'json', '.'],
          cwd: context.root,
          signal,
        });
      } catch {
        return;
      }
      if (reportToolTimeout(context, 'ruff', tool.command, run)) return;
      if (signal.aborted || run.stdout.trim() === '') return;

      let messages: RuffMessage[];
      try {
        messages = JSON.parse(run.stdout) as RuffMessage[];
      } catch {
        return;
      }

      // Per-file source + line-start cache, so converting a fix's row/col to offsets reads each file
      // at most once. Keyed by the absolute path Ruff reported.
      const absByRel = new Map(context.files.map((f) => [f.file, f.absPath] as const));
      const lineCache = new Map<string, { source: string; starts: number[] } | null>();
      const linesFor = (rel: string): { source: string; starts: number[] } | null => {
        if (!lineCache.has(rel)) {
          const abs = absByRel.get(rel);
          const source = abs === undefined ? null : context.readSource(abs);
          lineCache.set(rel, source === null ? null : { source, starts: lineStarts(source) });
        }
        return lineCache.get(rel) ?? null;
      };

      const byFile = new Map<string, RawFinding[]>();
      for (const message of messages) {
        if (message.code === null) continue;
        const file = toRelPosix(context.root, message.filename);
        const fixable = message.fix !== undefined && message.fix !== null;
        // Only a Ruff-declared SAFE fix becomes an autofix. `unsafe`/`display` fixes can change
        // behaviour, which is exactly what a deterministic micro-repair must never do unattended —
        // those are left for the AI path, where the change is reviewed. Positions convert to offsets
        // against the file's own source; a fix that cannot be placed exactly is dropped, not guessed.
        const autofix = ((): RawFinding['autofix'] => {
          const fix = message.fix;
          if (fix?.applicability !== 'safe') return undefined;
          const ctxLines = linesFor(file);
          if (ctxLines === null) return undefined;
          const edits = [];
          for (const edit of fix.edits) {
            const start = toOffset(ctxLines.starts, edit.location, ctxLines.source.length);
            const end = toOffset(ctxLines.starts, edit.end_location, ctxLines.source.length);
            if (start === null || end === null || start > end) return undefined;
            edits.push({ range: [start, end] as [number, number], text: edit.content });
          }
          return edits.length > 0 ? { source: 'ruff' as const, edits } : undefined;
        })();

        const raw: RawFinding = {
          ruleId: message.code,
          severity: severityFor(message.code),
          category: categoryFor(message.code),
          message: message.message,
          startLine: message.location.row,
          startCol: message.location.column,
          ...(message.end_location !== undefined
            ? { endLine: message.end_location.row, endCol: message.end_location.column }
            : {}),
          fixable,
          ...(autofix !== undefined ? { autofix } : {}),
          toolOutput: message,
        };
        const list = byFile.get(file);
        if (list === undefined) byFile.set(file, [raw]);
        else list.push(raw);
      }

      yield* groundByFile('ruff', context, byFile, signal);
    },
  };
}
