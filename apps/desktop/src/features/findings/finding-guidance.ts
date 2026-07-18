import type { Category, Finding, FindingSource } from '@fixora/shared-types';

/**
 * The non-AI half of the problem details panel: what Fixora can say about a finding **without
 * calling a model**. Two rules govern everything here.
 *
 * 1. *Never invent rule-specific claims.* We do not ship a per-rule knowledge base, so we do not
 *    pretend to have one. The guidance below is written per **category** — true of every finding in
 *    that category by definition — and the rule-specific answer stays where it belongs: the tool's
 *    own docs (linked) or Explain (which reasons over the real evidence).
 * 2. *Never link to a page we are not confident exists.* A 404 is worse than no link. Only sources
 *    with a stable, derivable URL scheme get a deep link; the rest get their reference index, and
 *    the ones with neither get nothing.
 */

export type CategoryGuidance = {
  /** What this class of problem *is* — plain language, no jargon. */
  what: string;
  /** What can happen if it is left alone. Honest about severity, including "nothing at runtime". */
  ifIgnored: string;
  /** The shape a fix usually takes. Direction, not a patch — the patch comes from Repair. */
  fix: string;
};

export const CATEGORY_GUIDANCE: Record<Category, CategoryGuidance> = {
  correctness: {
    what: 'The code does something other than what it appears to intend — a logic, typing, or control-flow mismatch the analyzer can prove from the code itself.',
    ifIgnored:
      'This is the category that becomes a bug report. Failures usually surface at runtime on the edge cases real users hit first, not on the happy path you tested.',
    fix: 'Decide which behaviour you actually want, then make it explicit — handle the case the tool flagged rather than relying on the value never occurring.',
  },
  security: {
    what: 'A pattern that can be abused: untrusted input reaching somewhere sensitive, a weak primitive, or data exposed further than intended.',
    ifIgnored:
      'Security issues rarely fail loudly. The code keeps working exactly as before right up until someone exploits it, which is why these are worth fixing even when nothing looks broken.',
    fix: 'Remove the unsafe pattern rather than guarding around it: validate or escape at the boundary, use the vetted API instead of the raw one, and narrow what the code is allowed to reach.',
  },
  performance: {
    what: 'Work being done more expensively than it needs to be — repeated computation, an avoidable allocation, or an operation inside a loop that belongs outside it.',
    ifIgnored:
      'Usually invisible on small inputs and painful under load, where it shows up as latency and cost rather than as an error.',
    fix: 'Do the work once and reuse it, or move it out of the hot path. Measure before and after — the analyzer flags the pattern, not the impact.',
  },
  maintainability: {
    what: 'The code is harder to change safely than it needs to be: too many branches, too much in one unit, or an implicit dependency a reader has to reconstruct.',
    ifIgnored:
      'No runtime effect today. The cost is paid later, by whoever changes this next — slower work and a higher chance of introducing a real bug while doing it.',
    fix: 'Reduce what the reader has to hold at once: split the unit, name the intermediate, or collapse the branching into one clear path.',
  },
  style: {
    what: "A deviation from the conventions this project's own configuration asks for.",
    ifIgnored:
      'Nothing breaks. The cost is inconsistency and noisier diffs, which makes real problems harder to spot in review.',
    fix: 'Match the surrounding convention. Many style rules ship an automatic fix in the tool itself — check the Fixable badge above.',
  },
};

/**
 * The complexity analyzer is the one source that reports a *measurement*, and it puts the numbers in
 * `toolOutput`. Reading them lets the panel say something genuinely specific about this code ("12
 * against a limit of 11") instead of restating the category. Narrowed defensively: `toolOutput` is
 * typed `unknown` for a reason, and a shape change upstream must degrade to "no metric", not crash.
 */
export type ComplexityMetric = { metric: string; value: number; threshold: number };

export function complexityMetric(finding: Finding): ComplexityMetric | null {
  if (finding.source !== 'complexity') return null;
  const raw: unknown = finding.evidence.toolOutput;
  if (typeof raw !== 'object' || raw === null) return null;
  const { metric, value, threshold } = raw as Record<string, unknown>;
  if (typeof metric !== 'string' || typeof value !== 'number' || typeof threshold !== 'number') {
    return null;
  }
  return { metric, value, threshold };
}

/** How many lines the flagged region spans — the honest proxy for "how much code is involved". */
export function spanLines(finding: Finding): number {
  return Math.max(1, finding.location.endLine - finding.location.startLine + 1);
}

export type RiskLevel = 'critical' | 'high' | 'moderate' | 'low';

/**
 * Risk is **derived, not measured**, and the UI says so. The inputs are the two facts we actually
 * have — the analyzer's severity and the category — combined by the rule below. Security outranks
 * everything because a security finding that "works fine" is the dangerous case; style is capped low
 * because it has no runtime effect by definition.
 */
export function riskLevelFor(finding: Finding): RiskLevel {
  const { severity, category } = finding;
  if (category === 'style') return 'low';
  if (category === 'security') return severity === 'error' ? 'critical' : 'high';
  if (severity === 'error') return category === 'correctness' ? 'high' : 'moderate';
  if (severity === 'warning') return category === 'correctness' ? 'moderate' : 'low';
  return 'low';
}

export type Effort = { label: string; detail: string };

/**
 * A typical-effort estimate. This is a **heuristic over the facts we have** — whether the tool ships
 * an autofix, how much code the finding spans, and (for complexity) how far past the threshold it
 * sits — not a measurement of anyone's actual fix. The panel labels it as such; a confident-looking
 * "3 minutes" that came from nowhere would be exactly the kind of invented number this codebase
 * refuses elsewhere.
 */
export function effortFor(finding: Finding): Effort {
  if (finding.fixable) {
    return {
      label: 'Automatic',
      detail: `${SOURCE_LABEL[finding.source]} can apply this fix itself — no manual edit needed.`,
    };
  }

  const metric = complexityMetric(finding);
  if (metric !== null) {
    const over = metric.value - metric.threshold;
    const lines = spanLines(finding);
    if (over <= 2 && lines <= 60) {
      return {
        label: 'Moderate',
        detail: `${String(over)} over the limit across ${String(lines)} lines — usually one or two extractions.`,
      };
    }
    return {
      label: 'Larger',
      detail: `${String(over)} over the limit across ${String(lines)} lines — likely needs the unit split up, not just tidied.`,
    };
  }

  const lines = spanLines(finding);
  if (finding.category === 'style' || lines <= 3) {
    return { label: 'Small', detail: 'A localized edit at the reported line.' };
  }
  return {
    label: 'Moderate',
    detail: `The finding spans ${String(lines)} lines, so the change is not a one-liner.`,
  };
}

/**
 * Why *this* code triggered the rule. For a measured finding we can be exact. For everything else
 * the honest answer is the tool's own reason for this exact location — restating it as if we had
 * independently analysed the code would be a claim we cannot back.
 */
export function whyTriggered(finding: Finding): string {
  const metric = complexityMetric(finding);
  if (metric !== null) {
    const symbol = finding.evidence.enclosingSymbol;
    const where = symbol !== undefined ? `${symbol.kind} \`${symbol.name}\`` : 'this unit of code';
    return (
      `${where} scored ${String(metric.value)} against a limit of ${String(metric.threshold)}. ` +
      `The score counts independent paths through the code — every \`if\`, \`else if\`, loop, ` +
      `\`case\`, \`catch\`, and each \`&&\`/\`||\`/\`?:\` adds one. Across the ` +
      `${String(spanLines(finding))} lines from ${String(finding.location.startLine)} to ` +
      `${String(finding.location.endLine)}, that many decision points accumulated.`
    );
  }
  return (
    `${SOURCE_LABEL[finding.source]} reported this at line ${String(finding.location.startLine)}, ` +
    `column ${String(finding.location.startCol)}: “${finding.message}” — that is the tool's own ` +
    `reason for this exact location, not a general description of the rule.`
  );
}

/**
 * A concrete refactoring strategy. Keyed on rule families whose fix is genuinely unambiguous (there
 * is only one way `eqeqeq` is satisfied), and falling back to the category strategy otherwise. What
 * it never does is emit a patch for the user's code: this is guidance to write the fix yourself,
 * and a generated edit belongs in Repair, where it is verified before anyone can apply it.
 */
export type ManualFix = { strategy: string; illustration?: string };

export function manualFixFor(finding: Finding): ManualFix {
  const metric = complexityMetric(finding);
  if (metric !== null) {
    return {
      strategy:
        'Reduce the number of decision points in one place. In order of how often it works: ' +
        'replace nested conditionals with early returns (guard clauses) so the happy path stays flat; ' +
        'extract each cohesive block — validation, request building, response handling — into its own ' +
        'named function; and replace a long if/else-if chain that maps a value to behaviour with a ' +
        'lookup table. Splitting into named steps is what lowers the score, because each piece then ' +
        'carries only its own branching.',
      illustration:
        '// Before — nesting adds a path at every level\nif (a) {\n  if (b) {\n    doWork();\n  }\n}\n\n' +
        '// After — guard clauses keep the main path flat\nif (!a) return;\nif (!b) return;\ndoWork();',
    };
  }

  const family = RULE_FAMILY_FIX[normalizeRule(finding.ruleId)];
  if (family !== undefined) return family;

  return { strategy: CATEGORY_GUIDANCE[finding.category].fix };
}

/** Trailing plugin scope stripped, so `@typescript-eslint/eqeqeq` matches `eqeqeq`. */
function normalizeRule(ruleId: string): string {
  return ruleId.includes('/') ? (ruleId.split('/').pop() ?? ruleId) : ruleId;
}

/**
 * Rules whose remedy is not a judgement call. Deliberately short: a rule belongs here only when the
 * fix is fully determined by the rule itself. Anything requiring context about the program is left
 * to the category strategy and to Explain, which can actually read the code.
 */
const RULE_FAMILY_FIX: Record<string, ManualFix> = {
  eqeqeq: {
    strategy:
      'Use the strict operators `===` and `!==`. The loose ones coerce types before comparing, ' +
      'which is where the surprises come from (`0 == ""` is true). If you genuinely want to catch ' +
      'both `null` and `undefined`, `x == null` is the one conventional exception.',
  },
  'no-unused-vars': {
    strategy:
      'Delete it. An unused binding is either leftover from a change that is now finished, or a ' +
      'sign the value it held was meant to be used and is not — check which before removing. If it ' +
      'is a deliberately ignored parameter, prefix it with an underscore.',
  },
  'no-explicit-any': {
    strategy:
      'Give the value a real type. If you know the shape, write it; if it varies, a union or a ' +
      'generic parameter keeps the checking. When the value is genuinely unknown at this boundary ' +
      '(parsed JSON, an external payload), use `unknown` and narrow it — `unknown` forces the check ' +
      'that `any` silently skips.',
  },
  'no-floating-promises': {
    strategy:
      'Decide what should happen if this rejects. `await` it if the caller should wait, `return` it ' +
      'if the caller should own it, or mark it `void` with a `.catch` if it is genuinely fire-and-' +
      'forget. An unhandled rejection is a failure that never reaches your error handling.',
  },
  'no-eval': {
    strategy:
      'Remove `eval` rather than sanitising its input. If it parses data, use `JSON.parse`; if it ' +
      'dispatches to behaviour by name, use a lookup object mapping names to functions. Any path ' +
      'where user input reaches `eval` is arbitrary code execution.',
  },
};

export type DocsLink = { href: string; label: string };

/** A documentation link we are confident about, or null. Silence beats a broken link. */
export function docsLinkFor(finding: Finding): DocsLink | null {
  const { source, ruleId } = finding;
  switch (source satisfies FindingSource) {
    case 'eslint':
      // Core rules have a stable per-rule page; plugin rules ("plugin/rule") do not live on
      // eslint.org, so we say nothing rather than guess a plugin's docs host.
      return ruleId !== '' && !ruleId.includes('/')
        ? {
            href: `https://eslint.org/docs/latest/rules/${encodeURIComponent(ruleId)}`,
            label: `ESLint: ${ruleId}`,
          }
        : null;
    case 'ruff':
      return { href: 'https://docs.astral.sh/ruff/rules/', label: 'Ruff rule reference' };
    case 'mypy':
      return {
        href: 'https://mypy.readthedocs.io/en/stable/error_code_list.html',
        label: 'mypy error codes',
      };
    case 'go-vet':
      return { href: 'https://pkg.go.dev/cmd/vet', label: 'go vet reference' };
    case 'semgrep':
      return ruleId.includes('.')
        ? { href: `https://semgrep.dev/r/${encodeURI(ruleId)}`, label: `Semgrep: ${ruleId}` }
        : null;
    // TypeScript has no official per-error page, and complexity/ai findings are ours — nothing to
    // link that would tell the reader more than the panel already does.
    case 'tsc':
    case 'complexity':
    case 'ai':
      return null;
  }
}

/** Human label for a source, for the details header. */
export const SOURCE_LABEL: Record<FindingSource, string> = {
  eslint: 'ESLint',
  tsc: 'TypeScript',
  ruff: 'Ruff',
  mypy: 'mypy',
  'go-vet': 'go vet',
  semgrep: 'Semgrep',
  complexity: 'Complexity',
  ai: 'AI',
};
