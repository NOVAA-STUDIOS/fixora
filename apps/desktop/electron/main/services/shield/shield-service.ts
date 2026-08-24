import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

import type {
  CodeShieldReport,
  Finding,
  Severity,
  ShieldCategory,
  ShieldCheck,
  ShieldIssue,
  ShieldSensitivity,
} from '@fixora/shared-types';
import type { BrowserWindow } from 'electron';

import { targetFor, type AnalysisService } from '../../analysis/analysis-service.js';
import type { FindingsRepository } from '../../db/repositories.js';
import { assertInsideWorkspace } from '../fs/path-guard.js';
import type { WorkspaceService } from '../workspace-service.js';

/** How long a single-file analysis may run before the Shield gives up on it. Analyzers already have
 *  their own internal timeouts (analysis-host.ts); this is the outer bound that guarantees the
 *  panel never spins forever waiting on a hung tool. */
const ANALYSIS_TIMEOUT_MS = 30_000;

/**
 * Code Shield — a per-file quality report, derived entirely from what the real analyzers found.
 *
 * The one rule this file exists to keep: **nothing here is invented.** Every issue is an actual
 * `Finding` produced by ESLint/tsc/Ruff/etc., every number in the score traces to a counted finding,
 * and a run that fails reports an error rather than a plausible-looking score. A trust surface that
 * guesses is worse than no trust surface, because the user cannot tell which reading was the guess.
 */

/** Score penalties. Deterministic and capped, so the same findings always produce the same score. */
const CRITICAL_PENALTY = 15;
const CRITICAL_PENALTY_CAP = 45;
const WARNING_PENALTY = 5;
const WARNING_PENALTY_CAP = 25;
const NO_TESTS_PENALTY = 10;

const READY_AT = 85;
const NEEDS_WORK_AT = 60;

/**
 * Which severities the report counts, per sensitivity. This is the ONLY thing sensitivity changes:
 * it selects which real findings are in scope, and the score then follows from those. It never
 * scales or nudges an already-computed number — a score that moved without a finding moving would
 * be exactly the kind of unexplainable figure this feature must not produce.
 */
const INCLUDED_SEVERITIES: Record<ShieldSensitivity, readonly Severity[]> = {
  strict: ['error', 'warning', 'info'],
  balanced: ['error', 'warning'],
  relaxed: ['error'],
};

/** The analyzers' categories, in the Shield's vocabulary. A total mapping — no finding is dropped
 *  for having a category this feature did not anticipate. */
const CATEGORY_MAP: Record<Finding['category'], ShieldCategory> = {
  correctness: 'bugs',
  security: 'security',
  performance: 'performance',
  maintainability: 'style',
  style: 'style',
};

/**
 * Rule-specific advice, keyed by the rule id the analyzer actually reported.
 *
 * Deliberately a lookup rather than a model call: this text is shown as authoritative senior
 * guidance, and a sentence generated per-issue at file-open time would be unverifiable, different
 * on every run, and billed to the user's own provider key on a surface they never asked to spend
 * on. Every entry below is advice for that exact rule; anything not listed falls back to the
 * finding's own analyzer message, which is real by construction.
 */
const RULE_ADVICE: Record<string, string> = {
  'no-eval': 'Replace eval() with an explicit parser or lookup — eval runs whatever string reaches it.',
  'no-implied-eval': 'Pass a real function instead of a string, so nothing is compiled at runtime.',
  'no-new-func': 'Build the behaviour as a normal function rather than compiling one from a string.',
  'detect-sql-injection': 'Use parameterized queries so user input can never become SQL syntax.',
  'no-unsanitized/method': 'Sanitize or escape this value before it reaches the DOM.',
  'no-unsanitized/property': 'Assign text content instead of HTML, or sanitize before assigning.',
  'no-secrets/no-secrets': 'Move this value into an environment variable and rotate it — it is in source.',
  'no-unused-vars': 'Delete the unused binding, or prefix it with _ if it is deliberately ignored.',
  '@typescript-eslint/no-unused-vars':
    'Delete the unused binding, or prefix it with _ if it is deliberately ignored.',
  'no-undef': 'Import or declare this name — it does not resolve to anything at runtime.',
  'no-console': 'Use the app logger instead of console so this line is controllable in production.',
  eqeqeq: 'Use === so the comparison does not silently coerce types.',
  'no-debugger': 'Remove the debugger statement before this ships.',
  '@typescript-eslint/no-explicit-any':
    'Give this a real type — any switches off the checking that would catch the next bug here.',
  '@typescript-eslint/no-floating-promises':
    'Await this promise or mark it void, so a rejection cannot vanish unhandled.',
  '@typescript-eslint/no-unsafe-assignment':
    'Type or validate this value at the boundary rather than letting any flow inward.',
  'react-hooks/exhaustive-deps':
    'Add the missing dependency, or the effect will keep reading a stale value.',
  'react-hooks/rules-of-hooks': 'Call this hook unconditionally at the top level of the component.',
  'prefer-const': 'Use const — this binding is never reassigned.',
  'no-fallthrough': 'Add a break or an explicit fallthrough comment so the intent is unambiguous.',
};

/** Advice when the rule is not in the table above. Still specific: it names the real rule and
 *  category, and carries the analyzer's own message rather than a generic platitude. */
function adviceFor(finding: Finding): string {
  const known = RULE_ADVICE[finding.ruleId];
  if (known !== undefined) return known;
  if (finding.category === 'security') {
    return `Security rule ${finding.ruleId} fired here: ${finding.message}`;
  }
  if (finding.category === 'performance') {
    return `Performance rule ${finding.ruleId} fired here: ${finding.message}`;
  }
  return `${finding.ruleId}: ${finding.message}`;
}

function toIssue(finding: Finding, severity: 'critical' | 'warning'): ShieldIssue {
  return {
    id: finding.id,
    severity,
    category: CATEGORY_MAP[finding.category],
    message: finding.message,
    file: finding.location.file,
    line: finding.location.startLine,
    seniorAdvice: adviceFor(finding),
    // Strictly the analyzer's own deterministic autofix — never a promise that AI *might* manage it.
    fixAvailable: finding.fixable,
  };
}

/** Is this file itself a test, or does a test file sit beside it? Filesystem truth only — an
 *  unresolvable answer must not become a confident "no tests". */
function hasTests(root: string, relPath: string): boolean {
  const name = relPath.split('/').pop() ?? relPath;
  if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(name)) return true;

  const stem = name.replace(/\.[cm]?[jt]sx?$/, '');
  const ext = /\.([cm]?[jt]sx?)$/.exec(name)?.[1];
  if (ext === undefined) return false;

  const dir = dirname(relPath);
  const candidates = [
    `${stem}.test.${ext}`,
    `${stem}.spec.${ext}`,
    join('__tests__', `${stem}.test.${ext}`),
    join('__tests__', `${stem}.spec.${ext}`),
  ];
  for (const candidate of candidates) {
    const rel = dir === '.' ? candidate : join(dir, candidate);
    try {
      if (existsSync(assertInsideWorkspace(join(root, rel), root))) return true;
    } catch {
      // Outside the workspace or unreadable — not evidence of a test, and not worth failing over.
    }
  }
  return false;
}

export function createShieldService(deps: {
  workspace: WorkspaceService;
  analysis: AnalysisService;
  findings: FindingsRepository;
}) {
  return {
    /**
     * Re-analyze one file and report on it. `window` is required because the analysis worker streams
     * through it — the same path Watch Mode uses.
     */
    async analyzeFile(
      window: BrowserWindow,
      relPath: string,
      sensitivity: ShieldSensitivity,
    ): Promise<CodeShieldReport> {
      const empty = (error: string): CodeShieldReport => ({
        score: null,
        critical: [],
        warnings: [],
        passed: [],
        prReadiness: 'not-ready',
        analyzedAt: Date.now(),
        file: relPath,
        error,
      });

      const open = deps.workspace.getCurrent();
      if (open === null) return empty('No project is open.');

      // Not analyzable at all (wrong file type, binary, too large, gitignored, secret-denied, or the
      // file no longer exists) — the SAME vetting `run()`/Watch Mode apply, checked BEFORE scoring so
      // a file that was never analyzed can never read back as a clean 90.
      if (targetFor(open, relPath) === null) {
        return empty('File type not supported for analysis.');
      }

      type Outcome = { reason: 'ok' | 'timeout' | 'failed' };
      let outcome: Outcome;
      try {
        // Real analyzers, real findings. This persists into the findings repo exactly as Watch Mode
        // does, so the Shield and the Problems panel can never disagree about the same file. Bounded
        // by an outer timeout — a hung tool must end the wait, not the report's accuracy.
        outcome = await Promise.race<Outcome>([
          deps.analysis.analyzeFile(window, relPath).then((r) => ({ reason: r.ok ? 'ok' : 'failed' })),
          new Promise<Outcome>((resolve) => {
            setTimeout(() => {
              resolve({ reason: 'timeout' });
            }, ANALYSIS_TIMEOUT_MS).unref();
          }),
        ]);
      } catch (error) {
        return empty(error instanceof Error ? error.message : 'Analysis failed.');
      }
      if (outcome.reason === 'timeout') return empty('Analysis timed out.');
      if (outcome.reason === 'failed') return empty('Analysis failed to complete.');

      const included = INCLUDED_SEVERITIES[sensitivity];
      const all = deps.findings
        .list(open.id, { relPath })
        .filter((f) => included.includes(f.severity));

      const critical = all.filter((f) => f.severity === 'error').map((f) => toIssue(f, 'critical'));
      const warnings = all.filter((f) => f.severity !== 'error').map((f) => toIssue(f, 'warning'));

      const testsPresent = hasTests(open.rootPath, relPath);

      const criticalPenalty = Math.min(critical.length * CRITICAL_PENALTY, CRITICAL_PENALTY_CAP);
      const warningPenalty = Math.min(warnings.length * WARNING_PENALTY, WARNING_PENALTY_CAP);
      const testPenalty = testsPresent ? 0 : NO_TESTS_PENALTY;
      const score = Math.max(0, 100 - criticalPenalty - warningPenalty - testPenalty);

      const passed: ShieldCheck[] = [
        {
          name: 'No critical issues',
          passed: critical.length === 0,
          message:
            critical.length === 0
              ? 'No errors reported by the analyzers.'
              : `${String(critical.length)} error${critical.length === 1 ? '' : 's'} reported.`,
        },
        {
          name: 'No warnings',
          passed: warnings.length === 0,
          message:
            warnings.length === 0
              ? 'No warnings reported by the analyzers.'
              : `${String(warnings.length)} warning${warnings.length === 1 ? '' : 's'} reported.`,
        },
        {
          name: 'Tests present',
          passed: testsPresent,
          // The one deduction that is easy to miss otherwise: the -10 is stated right where the
          // check is reported, so the score is never a number with no visible reason behind it.
          message: testsPresent
            ? 'A test file was found for this file.'
            : `📋 No test coverage detected (-${String(NO_TESTS_PENALTY)})`,
        },
      ];

      return {
        score,
        critical,
        warnings,
        passed,
        prReadiness: score >= READY_AT ? 'ready' : score >= NEEDS_WORK_AT ? 'needs-work' : 'not-ready',
        analyzedAt: Date.now(),
        file: relPath,
        error: null,
      };
    },
  };
}

export type ShieldService = ReturnType<typeof createShieldService>;
