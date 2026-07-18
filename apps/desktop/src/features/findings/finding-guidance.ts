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
