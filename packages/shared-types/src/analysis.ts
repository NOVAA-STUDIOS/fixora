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

/** The languages Fixora analyzes deeply — three deep, not ten shallow (ADR-025). */
export const LanguageSchema = z.enum(['typescript', 'javascript', 'python', 'go']);
export type Language = z.infer<typeof LanguageSchema>;

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
  snippet: z.string(),
  relatedLocations: z.array(LocationSchema),
  toolOutput: z.unknown(),
});
export type Evidence = z.infer<typeof EvidenceSchema>;

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
  bySource: z.record(FindingSourceSchema, z.number().int().nonnegative()),
});
export type FindingsSummary = z.infer<typeof FindingsSummarySchema>;

/** The analysis run lifecycle the engine reports to the panel (main → renderer event). */
export const AnalysisStateSchema = z.object({
  status: z.enum(['idle', 'running', 'done', 'error']),
  summary: FindingsSummarySchema.optional(),
  message: z.string().optional(),
});
export type AnalysisState = z.infer<typeof AnalysisStateSchema>;
