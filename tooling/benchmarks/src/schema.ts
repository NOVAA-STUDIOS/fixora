import { z } from 'zod';

/**
 * The Golden Dataset schema.
 *
 * A benchmark case is a small project plus a manifest stating, exactly, what Fixora is expected to
 * report about it. The manifest is the contract: it is the thing a release is measured against, and
 * changing an expectation is a deliberate act that has to be justified in review — which is only
 * enforceable if the expectation is data rather than prose.
 *
 * Every field that the runner compares is declared here. Anything not declared is not measured, and
 * the report says so rather than quietly scoring it as a pass.
 */

/** Severity as the analysis contract defines it. Kept as a literal union so a typo fails the parse. */
export const SeveritySchema = z.enum(['error', 'warning', 'info']);

/**
 * A single expected finding.
 *
 * `column` is optional because not every analyzer reports one usefully — tsc and ruff do, some
 * ESLint rules report column 1 for a whole-statement violation. Declaring it optional is honest;
 * defaulting it to 1 and comparing would manufacture failures that mean nothing.
 */
export const ExpectedFindingSchema = z.object({
  /** Workspace-relative POSIX path, matching what the engine emits. */
  file: z.string().min(1),
  /** 1-based. The line the finding must be reported on. */
  line: z.number().int().positive(),
  /** 1-based. Compared only when present. */
  column: z.number().int().positive().optional(),
  /** The exact rule id, e.g. `no-unused-vars`, `TS2304`, `F821`. */
  ruleId: z.string().min(1),
  severity: SeveritySchema,
  /** Which analyzer must produce it: eslint | tsc | ruff | mypy | go-vet | semgrep | complexity. */
  analyzer: z.string().min(1),
  /** Whether the producing tool advertises an automatic fix (`Finding.fixable`). */
  repairAvailable: z.boolean(),
  /** Why this finding is expected. Read by a human reviewing a change to the expectation. */
  note: z.string().optional(),
});
export type ExpectedFinding = z.infer<typeof ExpectedFindingSchema>;

/**
 * Support status, declared per case.
 *
 * `unsupported` is not a failure and must never be scored as one. HTML, CSS and JSON have no
 * analyzer — `languageForPath` returns null for them, so nothing ever runs. Their cases exist to
 * keep the gap visible and to fail loudly the day an analyzer appears and starts producing output
 * nobody wrote expectations for. They are excluded from every accuracy metric.
 */
export const SupportSchema = z.enum(['supported', 'unsupported']);

export const BenchmarkCaseSchema = z.object({
  /** Stable identifier. Used in the report and in the CI baseline, so it must not churn. */
  id: z.string().min(1),
  language: z.enum(['javascript', 'typescript', 'react', 'python', 'html', 'css', 'json']),
  support: SupportSchema,
  /** One line, human-readable: what this case is testing. */
  description: z.string().min(1),
  /**
   * What kind of evidence this case provides. Drives nothing in the maths — it is how the report
   * groups results, so "our false-positive suite" is answerable without reading every manifest.
   */
  kind: z.enum([
    'valid',
    'invalid',
    'edge-case',
    'real-world',
    'known-false-positive',
    'known-false-negative',
    'large-file',
    'multi-file',
  ]),
  /**
   * The tools this case needs. A case is SKIPPED (not failed) when a tool is absent, because a
   * missing tsc on the runner is a fact about the runner, not about Fixora's accuracy.
   */
  requiresTools: z.array(z.string()).default([]),
  expected: z.array(ExpectedFindingSchema),
  /**
   * Rules to ignore entirely when scoring this case.
   *
   * The escape hatch that keeps the dataset honest about *scope*. A React case is measuring
   * react-hooks rules; if the project's ESLint config also reports `no-unused-vars`, that finding is
   * correct and simply not what this case is about. Ignoring it is different from marking it
   * expected, and different again from calling it a false positive — so it gets its own field, and
   * the report counts how many findings each case ignored.
   */
  ignoreRules: z.array(z.string()).default([]),
  /** Why this case is marked unsupported. Required when it is — no silent gaps. */
  unsupportedReason: z.string().optional(),
  /**
   * A defect Fixora is known to have, which this case is expected to expose.
   *
   * The alternative — editing the expectation to match what Fixora currently does — would make the
   * dataset agree with the product by construction, and a dataset that always agrees measures
   * nothing. So the expectation keeps stating what *should* happen, the case is allowed to fail,
   * and the failure is surfaced in its own section of the report rather than blocking CI.
   *
   * This is the only sanctioned way to have a failing expectation. It requires a written reason,
   * so nobody can quiet a real regression by labelling it "known".
   */
  knownDefect: z.object({ reason: z.string().min(1), owner: z.string().optional() }).optional(),
});
export type BenchmarkCase = z.infer<typeof BenchmarkCaseSchema>;

/** Parse a manifest, with the file path in the error so a bad manifest names itself. */
export function parseManifest(raw: unknown, path: string): BenchmarkCase {
  const result = BenchmarkCaseSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(`Invalid benchmark manifest at ${path}:\n${z.prettifyError(result.error)}`);
  }
  const parsed = result.data;
  if (parsed.support === 'unsupported' && parsed.unsupportedReason === undefined) {
    throw new Error(
      `${path}: a case marked "unsupported" must state unsupportedReason — an undocumented gap is how a gap becomes permanent.`,
    );
  }
  return parsed;
}
