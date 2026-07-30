import { z } from 'zod';

/**
 * The unified analysis vocabulary (TDD §5.1). Everything downstream — the findings panel, the AI
 * context, the verification comparison, the golden corpus scorer — speaks this one `Finding` type,
 * so it lives in the contract layer, not in any one engine. It is pure zod (shared-types depends on
 * nothing else): `core-analysis` produces `Finding`s, the IPC layer streams them, the renderer
 * renders them, and none of those packages own the shape.
 *
 * This is the moat's data model and it contains **zero AI** (ADR-002): a finding always has a rule
 * id, a location, and evidence. The `ai` source exists only so a later milestone can add reasoning
 * *on top of* grounded findings — it is the sole source allowed a confidence below 1.
 */

/**
 * The languages Fixora analyzes. `typescript`/`javascript`/`python`/`go` get the full deep pipeline
 * (tree-sitter symbols, external tools). `json`/`css`/`html` are Tier-B validation languages
 * (ADR-025): they have a validator but no symbol/complexity analysis, so code that walks symbols must
 * scope itself to the deep set rather than the whole enum.
 *
 * `css`/`html` were previously absent, which meant they were silently skipped by analysis and then
 * refused by Repair/Proceed as "unsupported" — the two languages a user is most likely to expect a
 * web tool to handle. They are Tier-B for the same reason `json` is: their authoritative defect is
 * *invalidity* (an unclosed block, a mis-nested tag), which the grammar itself judges, and no linter
 * or type checker for them ships in this stack. So a css/html repair is validated by syntax +
 * regression checks only — real gates, but narrower than the tsc/eslint/ruff ones, and the UI must
 * never imply otherwise.
 */
export const LanguageSchema = z.enum([
  'typescript',
  'javascript',
  'python',
  'go',
  'json',
  'css',
  'html',
]);
export type Language = z.infer<typeof LanguageSchema>;

/**
 * How a finding can be repaired (M6 Goal 5). Every finding carries one:
 *  - `safe-auto`   — a tool shipped a deterministic fix; a micro-repair can apply it, no model.
 *  - `ai-required` — no deterministic fix, but a model could propose one (verified before Apply).
 *  - `manual`      — no fix a machine should attempt; the intent is the author's to supply.
 */
export const RepairStrategySchema = z.enum(['safe-auto', 'ai-required', 'manual']);
export type RepairStrategy = z.infer<typeof RepairStrategySchema>;

/**
 * Where a finding came from. The deterministic tools (everything but `ai`) are the grounding; `ai`
 * is the only source permitted a confidence below 1.0, and it never appears without deterministic
 * evidence to reason over (ADR-002).
 */
export const FindingSourceSchema = z.enum([
  'eslint',
  'tsc',
  'ruff',
  'mypy',
  'go-vet',
  'semgrep',
  'complexity',
  'json',
  // Tier-B syntax validators, like `json`: the grammar itself is the authority on validity, so these
  // need no external tool and always apply to their language.
  'css',
  'html',
  'ai',
]);
export type FindingSource = z.infer<typeof FindingSourceSchema>;

export const SeveritySchema = z.enum(['error', 'warning', 'info']);
export type Severity = z.infer<typeof SeveritySchema>;

export const CategorySchema = z.enum([
  'correctness',
  'security',
  'performance',
  'maintainability',
  'style',
]);
export type Category = z.infer<typeof CategorySchema>;

/**
 * A source location. `file` is always a **workspace-relative POSIX path** — the same discipline the
 * FS layer enforces (Security §3); an adapter that gets an absolute path from a tool relativises it
 * before a `Finding` leaves the engine. Lines and columns are **1-based** (what an editor shows and
 * what Monaco uses); adapters normalise each tool's own convention to this one.
 */
export const LocationSchema = z.object({
  file: z.string(),
  startLine: z.number().int().positive(),
  startCol: z.number().int().positive(),
  endLine: z.number().int().positive(),
  endCol: z.number().int().positive(),
});
export type Location = z.infer<typeof LocationSchema>;

export const SymbolKindSchema = z.enum([
  'function',
  'method',
  'class',
  'interface',
  'struct',
  'variable',
  'type',
  'module',
]);
export type SymbolKind = z.infer<typeof SymbolKindSchema>;

/** A symbol reference from tree-sitter — the enclosing function/class a finding sits in. */
export const SymbolRefSchema = z.object({
  name: z.string(),
  kind: SymbolKindSchema,
  location: LocationSchema,
});
export type SymbolRef = z.infer<typeof SymbolRefSchema>;

/**
 * What makes the finding *grounded* rather than a guess (ADR-002). `toolOutput` keeps the raw
 * emitter payload for debugging and for the golden corpus; everything else is normalised.
 */
export const EvidenceSchema = z.object({
  enclosingSymbol: SymbolRefSchema.optional(),
  /**
   * The smallest syntactically COMPLETE unit (top-level statement/declaration) that contains the
   * finding, when no named symbol does. A repair targets this range so it always replaces a whole,
   * splice-valid unit rather than a partial line — the fix for parser-rejected repairs on findings
   * inside object literals, type members, and other non-symbol code. 1-based, inclusive.
   */
  enclosingRange: z
    .object({ startLine: z.number().int().positive(), endLine: z.number().int().positive() })
    .optional(),
  /**
   * The Semantic + Dependency scope (Repair Context Engine v3): ranges, in the SAME file, of the
   * imports and declarations the repair target references — the interface it implements, the import it
   * uses. A repair prompt includes these so the model rewrites against what the code actually refers
   * to, not against a guess. Selected by name from the parsed structure, capped and relevant-only.
   */
  contextRanges: z
    .array(
      z.object({
        label: z.string(),
        startLine: z.number().int().positive(),
        endLine: z.number().int().positive(),
      }),
    )
    .optional(),
  snippet: z.string(),
  relatedLocations: z.array(LocationSchema),
  toolOutput: z.unknown(),
});
export type Evidence = z.infer<typeof EvidenceSchema>;

/**
 * A single edit in a tool-authored autofix, as a **character-offset range** on the ORIGINAL file
 * text: replace `[start, end)` with `text`. Offsets, not line/col, so applying an edit is an exact
 * splice with no re-tokenisation. ESLint expresses its fixes exactly this way; the Ruff adapter
 * converts its row/col edits to offsets before they get here, so the shape downstream is uniform.
 *
 * This is deliberately NOT a free-form text patch: it is the linter's own AST-based fixer output.
 * Fixora never invents an edit by string-munging — an autofix is only ever a fix the tool authored,
 * which is what makes a micro-repair AST-aware rather than a risky regex replacement.
 */
export const AutofixEditSchema = z.object({
  range: z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()]),
  text: z.string(),
});
export type AutofixEdit = z.infer<typeof AutofixEditSchema>;

export const AutofixSchema = z.object({
  /** The tool that authored this fix — recorded so its provenance is never mistaken for AI. */
  source: FindingSourceSchema,
  edits: z.array(AutofixEditSchema).min(1),
});
export type Autofix = z.infer<typeof AutofixSchema>;

/**
 * The unified finding. `id` is **stable across runs** — it hashes the rule, file, enclosing symbol
 * and a *normalised* snippet, never the raw line number, so a finding keeps its identity when a
 * patch shifts lines around it. That stability is what makes the verification comparison ("did the
 * fix resolve *this* finding, or introduce a *new* one?") and the golden corpus possible (TDD §5.1).
 * `id` generation lives in `core-analysis` (`findingId`); the schema only pins the shape.
 */
export const FindingSchema = z.object({
  id: z.string().min(1),
  source: FindingSourceSchema,
  ruleId: z.string(),
  severity: SeveritySchema,
  category: CategorySchema,
  location: LocationSchema,
  message: z.string(),
  evidence: EvidenceSchema,
  /** Does the underlying tool already have a deterministic autofix? */
  fixable: z.boolean(),
  /**
   * The tool-authored fix itself, when there is one. Present only when `fixable` is true and the tool
   * emitted an applicable edit. This is what a deterministic micro-repair applies — no model involved.
   */
  autofix: AutofixSchema.optional(),
  /** How this finding can be repaired (M6 Goal 5). Set on every finding the analyzers produce. */
  repair: RepairStrategySchema,
  /** 1.0 for deterministic tools; below 1.0 only for `source: 'ai'`. */
  confidence: z.number().min(0).max(1),
});
export type Finding = z.infer<typeof FindingSchema>;

/** The filters the findings panel applies — by severity, source and/or file (all optional). */
export const FindingsFilterSchema = z.object({
  severity: SeveritySchema.optional(),
  source: FindingSourceSchema.optional(),
  relPath: z.string().optional(),
});
export type FindingsFilter = z.infer<typeof FindingsFilterSchema>;

/** Grouped counts for the panel header — computed in SQL, not by loading rows into the renderer. */
export const FindingsSummarySchema = z.object({
  total: z.number().int().nonnegative(),
  bySeverity: z.object({
    error: z.number().int().nonnegative(),
    warning: z.number().int().nonnegative(),
    info: z.number().int().nonnegative(),
  }),
  // Keyed by source, but only the sources actually present appear — a string-keyed record so a
  // partial map is valid (not every tool ran).
  bySource: z.record(z.string(), z.number().int().nonnegative()),
});
export type FindingsSummary = z.infer<typeof FindingsSummarySchema>;

/** The analysis run lifecycle the engine reports to the panel (main → renderer event). */
export const AnalysisStateSchema = z.object({
  status: z.enum(['idle', 'running', 'done', 'error']),
  summary: FindingsSummarySchema.optional(),
  message: z.string().optional(),
});
export type AnalysisState = z.infer<typeof AnalysisStateSchema>;
