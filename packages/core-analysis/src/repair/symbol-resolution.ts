import type { Finding, Location, SymbolRef } from '@fixora/shared-types';

/**
 * Context-aware symbol resolution for "undefined name" findings (TS2304, Ruff F821).
 *
 * These two rules used to be refused outright: `MANUAL_ONLY_RULES` classified them `manual` on the
 * argument that "the correct identifier is a guess only the author can make". That argument is right
 * in general and wrong in the common case — when a file imports `useState` and the code says
 * `useSate`, the intended name is not a guess, it is the only symbol in scope one edit away. Refusing
 * there sent the user to fix by hand something the engine could see perfectly well.
 *
 * So this module answers a narrower, answerable question: *is there exactly one symbol already in
 * scope that this identifier is overwhelmingly likely to be a misspelling of?* If yes, the repair is
 * a rename of a single token at a known offset — deterministic, minimal, and safe enough to apply
 * with no model. If the answer is unclear — several plausible candidates, or a weak match, or none —
 * it stays refused, because a confidently-applied wrong identifier is worse than no fix at all.
 *
 * ## What this deliberately does NOT do
 *
 * It never invents a name, never adds an import, and never reaches into a module's exports to see
 * what it *could* have exported. Adding a missing import means choosing a module specifier and an
 * insertion point — a materially larger edit with more ways to be wrong — so a finding whose only
 * plausible fix is a new import is left to the AI path (which is verified before Apply), not applied
 * deterministically here.
 *
 * ## Thresholds
 *
 * Every constant below is a safety valve, tuned so that a *weak* match is rejected rather than
 * applied. They are deliberately strict: this feature's failure mode is silently renaming an
 * identifier to the wrong thing, and the verifier cannot catch that — a wrong-but-defined name
 * compiles clean. So the gate is lexical confidence, and it is set high.
 */

/** Beyond this many single-character edits the two names are different words, not a typo. */
const MAX_EDIT_DISTANCE = 2;

/**
 * Minimum normalised similarity for a name to be a *candidate* at all. 0.7 rejects `foo`→`for`
 * (0.667) while keeping `usr`→`user` (0.75): on short identifiers one edit is a large proportion of
 * the word, and that is exactly when a "typo" is more likely to be a different variable.
 */
const MIN_SIMILARITY = 0.7;

/**
 * Minimum confidence to generate a DETERMINISTIC repair (no model). Above this the rename is applied
 * through the same parser-gate + verifier path as an ESLint autofix; below it, the finding is still
 * repairable but goes to the AI path, which sees the candidates as context and is verified.
 */
const AUTOFIX_MIN_CONFIDENCE = 0.85;

/**
 * How far ahead of the runner-up the best candidate must be. Two names equally close to the typo is
 * the ambiguous case the user must decide — `lenght` between `length` and `weight` is not a fix we
 * get to pick. Ambiguity degrades to the AI path, never to a coin flip.
 */
const MIN_CONFIDENCE_MARGIN = 0.1;

/** The rules this resolver applies to. Anything else is not its business. */
const UNDEFINED_NAME_RULES = new Set(['TS2304', 'F821']);

export function isUndefinedNameRule(ruleId: string): boolean {
  return UNDEFINED_NAME_RULES.has(ruleId);
}

/** Where a candidate symbol came from — reported so the user can see why it was offered. */
export type CandidateOrigin = 'same-file' | 'import' | 'project';

export interface SymbolCandidate {
  readonly name: string;
  readonly origin: CandidateOrigin;
  /** The candidate's declaration site, when known. Surfaced as a related location on the finding. */
  readonly location?: Location;
}

export interface ScoredCandidate extends SymbolCandidate {
  /** 0..1. Lexical confidence that this is the name the author meant. Never a semantic claim. */
  readonly confidence: number;
  readonly distance: number;
}

export type ResolutionOutcome =
  /** A single candidate cleared the autofix threshold: a deterministic rename is available. */
  | 'resolved'
  /** Candidates exist but none is safe to apply alone — the AI path gets them as context. */
  | 'ambiguous'
  /** Nothing in scope is close enough. This is the only case that stays `manual`. */
  | 'no-candidates'
  /** Not an undefined-name finding, or the message shape was unfamiliar. */
  | 'not-applicable';

export interface Resolution {
  readonly outcome: ResolutionOutcome;
  /** The undefined identifier, or null when it could not be read from the message. */
  readonly name: string | null;
  /** Ranked best-first. Empty unless the outcome is `resolved` or `ambiguous`. */
  readonly candidates: readonly ScoredCandidate[];
  /** Set only when `outcome === 'resolved'`. */
  readonly best: ScoredCandidate | null;
}

const NOT_APPLICABLE: Resolution = {
  outcome: 'not-applicable',
  name: null,
  candidates: [],
  best: null,
};

/**
 * Read the undefined identifier out of the tool's message.
 *
 * Both tools quote the name, but not with the same quote character (tsc uses `'`, Ruff uses a
 * backtick), and both have varied their phrasing across versions. Matching the quoted token after a
 * recognised phrase is stable across all of those without accepting arbitrary prose: if the shape is
 * unfamiliar we return null and the finding is left exactly as it was, rather than resolving against
 * a name we mis-parsed.
 */
export function extractUndefinedName(ruleId: string, message: string): string | null {
  if (!isUndefinedNameRule(ruleId)) return null;
  const match =
    /(?:cannot find name|undefined name|is not defined)\s*[:-]?\s*[`'"]([A-Za-z_$][\w$]*)[`'"]/i.exec(
      message,
    ) ?? /[`'"]([A-Za-z_$][\w$]*)[`'"]\s+is not defined/i.exec(message);
  return match?.[1] ?? null;
}

/**
 * Levenshtein distance, with an early exit once the distance provably exceeds `max`.
 *
 * The cap is not just a speed optimisation: every caller only cares whether the distance is small,
 * so computing the true distance between two unrelated 40-character identifiers is wasted work on
 * every finding in a large file.
 */
export function editDistance(a: string, b: string, max = MAX_EDIT_DISTANCE): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;

  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i, ...Array.from({ length: b.length }, () => 0)];
    let rowMin = current[0] ?? i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        (previous[j] ?? 0) + 1, // deletion
        (current[j - 1] ?? 0) + 1, // insertion
        (previous[j - 1] ?? 0) + cost, // substitution
      );
      rowMin = Math.min(rowMin, current[j] ?? 0);
    }
    // Every remaining row can only increase the running minimum, so we already exceed the cap.
    if (rowMin > max) return max + 1;
    previous = current;
  }
  return previous[b.length] ?? max + 1;
}

/**
 * Split an identifier into lowercase word tokens, across the three conventions these languages use:
 * `camelCase`, `snake_case`, and `SCREAMING_SNAKE`. Used for the token-overlap signal below.
 */
export function tokenize(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_$-]+/g, ' ')
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 0);
}

/** Jaccard overlap of two token sets — 1 when the names are the same words differently cased/ordered. */
function tokenOverlap(a: string, b: string): number {
  const setA = new Set(tokenize(a));
  const setB = new Set(tokenize(b));
  if (setA.size === 0 || setB.size === 0) return 0;
  let shared = 0;
  for (const t of setA) if (setB.has(t)) shared += 1;
  return shared / (setA.size + setB.size - shared);
}

/**
 * Confidence that `candidate` is what the author meant by `typo`.
 *
 * The base is normalised edit similarity — the honest, measurable signal. Two bonuses stack on top,
 * each for a case where a human would be certain and raw distance under-reports:
 *
 *  - a case-only difference (`usestate` → `useState`) is the single most common real typo and is
 *    essentially never a different variable, since neither language lets both spellings coexist
 *    meaningfully in one scope;
 *  - identical token sets (`get_user_name` → `getUserName`) means the same words in a different
 *    convention, which is a mechanical slip rather than a different concept.
 *
 * This is lexical throughout. It is *not* a semantic judgement about what the code means, and it is
 * named and reported that way so nobody mistakes the number for type-aware reasoning.
 */
export function scoreCandidate(
  typo: string,
  candidate: string,
): { confidence: number; distance: number } {
  const distance = editDistance(typo, candidate);
  const longest = Math.max(typo.length, candidate.length);
  if (longest === 0) return { confidence: 0, distance };
  const similarity = 1 - distance / longest;

  let confidence = similarity;
  if (typo.toLowerCase() === candidate.toLowerCase()) confidence += 0.1;
  else if (tokenOverlap(typo, candidate) === 1) confidence += 0.05;

  return { confidence: Math.min(1, Math.max(0, confidence)), distance };
}

/**
 * Rank the candidates that are plausibly the intended name, best first.
 *
 * Filtered before ranked: a name past `MAX_EDIT_DISTANCE` or below `MIN_SIMILARITY` is not a weak
 * candidate, it is a different identifier, and carrying it forward would only make the ambiguity
 * check noisier. Ties break toward the nearer scope (same file before import before project), since
 * a shadowing local is the more likely referent than a same-named symbol three directories away.
 */
export function rankCandidates(
  typo: string,
  candidates: readonly SymbolCandidate[],
): ScoredCandidate[] {
  const ORIGIN_RANK: Record<CandidateOrigin, number> = { 'same-file': 0, import: 1, project: 2 };
  const seen = new Set<string>();
  const scored: ScoredCandidate[] = [];

  for (const candidate of candidates) {
    // The identifier is undefined, so an exact match cannot be the thing it failed to resolve to —
    // it would mean the tool contradicted itself. Skip rather than "fix" a name to itself.
    if (candidate.name === typo) continue;
    const key = `${candidate.origin}:${candidate.name}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const { confidence, distance } = scoreCandidate(typo, candidate.name);
    if (distance > MAX_EDIT_DISTANCE) continue;
    const longest = Math.max(typo.length, candidate.name.length);
    if (1 - distance / longest < MIN_SIMILARITY) continue;
    scored.push({ ...candidate, confidence, distance });
  }

  return scored.sort(
    (a, b) =>
      b.confidence - a.confidence ||
      a.distance - b.distance ||
      ORIGIN_RANK[a.origin] - ORIGIN_RANK[b.origin] ||
      a.name.localeCompare(b.name),
  );
}

/**
 * Decide the outcome from the ranked list.
 *
 * A deterministic rename requires two things, not one: the best candidate must clear the confidence
 * threshold AND be clearly ahead of the runner-up. Confidence alone is not enough — two names can
 * both score 0.9 against the same typo, and picking either would be exactly the guess this module
 * exists to avoid.
 */
export function decide(typo: string, candidates: readonly SymbolCandidate[]): Resolution {
  const ranked = rankCandidates(typo, candidates);
  if (ranked.length === 0) {
    return { outcome: 'no-candidates', name: typo, candidates: [], best: null };
  }

  const best = ranked[0];
  if (best === undefined) {
    return { outcome: 'no-candidates', name: typo, candidates: [], best: null };
  }
  const runnerUp = ranked[1];
  const clearWinner =
    runnerUp === undefined || best.confidence - runnerUp.confidence >= MIN_CONFIDENCE_MARGIN;

  if (best.confidence >= AUTOFIX_MIN_CONFIDENCE && clearWinner) {
    return { outcome: 'resolved', name: typo, candidates: ranked, best };
  }
  return { outcome: 'ambiguous', name: typo, candidates: ranked, best: null };
}

/**
 * The character offset of the undefined identifier in the source, or null when it cannot be located
 * with certainty.
 *
 * This is the safety-critical step. An edit is applied by character range, so a wrong offset does not
 * fail loudly — it silently corrupts a different part of the file. So the identifier is located by
 * finding whole-word occurrences of the name on the reported line and taking the one nearest the
 * reported column, and the caller re-verifies the bytes before building an edit. Column conventions
 * differ between tools (1-based for tsc, and Ruff has varied), which is exactly why proximity is used
 * rather than trusting the column arithmetic outright.
 */
export function locateIdentifier(
  source: string,
  name: string,
  location: Pick<Location, 'startLine' | 'startCol'>,
): number | null {
  const lines = source.split('\n');
  const lineIndex = location.startLine - 1;
  if (lineIndex < 0 || lineIndex >= lines.length) return null;
  const line = lines[lineIndex] ?? '';

  // Offset of the start of this line in the whole source.
  let lineStart = 0;
  for (let i = 0; i < lineIndex; i++) lineStart += (lines[i] ?? '').length + 1;

  const pattern = new RegExp(`(?<![\\w$])${escapeRegExp(name)}(?![\\w$])`, 'g');
  const columns: number[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(line)) !== null) columns.push(match.index);
  if (columns.length === 0) return null;

  // Nearest to where the tool pointed, treating its column as 1-based.
  const target = Math.max(0, location.startCol - 1);
  let nearest = columns[0] ?? 0;
  for (const column of columns) {
    if (Math.abs(column - target) < Math.abs(nearest - target)) nearest = column;
  }
  return lineStart + nearest;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Build the deterministic rename edit, or null if the source does not read as expected at the offset.
 *
 * The read-back check is not defensive padding: it is what makes this safe to apply without a model.
 * If the bytes at the computed range are not exactly the identifier we intend to replace, we do not
 * know what we are editing, so we decline and let the finding fall through to the AI path.
 */
export function buildRenameAutofix(
  source: string,
  from: string,
  to: string,
  location: Pick<Location, 'startLine' | 'startCol'>,
): { range: [number, number]; text: string } | null {
  const offset = locateIdentifier(source, from, location);
  if (offset === null) return null;
  if (source.slice(offset, offset + from.length) !== from) return null;
  return { range: [offset, offset + from.length], text: to };
}

/** The symbols this resolver can draw on, gathered lazily so project-wide work is only paid when needed. */
export interface CandidateSources {
  /** Symbols declared in the finding's own file. */
  sameFile(): readonly SymbolCandidate[];
  /** Names bound by this file's import statements. */
  imports(): readonly SymbolCandidate[];
  /** Symbols declared anywhere else in the project. Consulted last — it is the expensive one. */
  project(): readonly SymbolCandidate[];
}

/**
 * Resolve an undefined-name finding against the widening scopes, stopping at the first that answers.
 *
 * Nearest-scope-first is both cheaper and more correct: a symbol in the same file or its imports is a
 * far more likely referent than a same-named symbol elsewhere in the project, and consulting the
 * project index at all is only worth its cost when the local scopes came up empty.
 */
export function resolveUndefinedName(
  finding: Pick<Finding, 'ruleId' | 'message'>,
  sources: CandidateSources,
): Resolution {
  const name = extractUndefinedName(finding.ruleId, finding.message);
  if (name === null) return NOT_APPLICABLE;

  const local = decide(name, [...sources.sameFile(), ...sources.imports()]);
  if (local.outcome === 'resolved' || local.outcome === 'ambiguous') return local;

  const projectWide = decide(name, sources.project());
  if (projectWide.outcome === 'resolved' || projectWide.outcome === 'ambiguous') return projectWide;

  return { outcome: 'no-candidates', name, candidates: [], best: null };
}

/**
 * The local names an import statement binds, read lexically from its own text.
 *
 * Lexical on purpose: resolving what a module *actually* exports would mean walking `node_modules`
 * and honouring tsconfig path mapping, which is a different feature with different failure modes.
 * What matters for a typo is the set of names already spelled out in this file, and that is exactly
 * what the statement text carries — `import { useState } from 'react'` makes `useState` a candidate
 * whether or not React really exports it.
 */
export function importedNames(statement: string): string[] {
  const names: string[] = [];
  // Named bindings: `{ a, b as c }` — `c` is the local name, so the alias wins when present.
  const braces = /\{([^}]*)\}/.exec(statement);
  if (braces?.[1] !== undefined) {
    for (const part of braces[1].split(',')) {
      const alias = /(?:\bas\b\s+)([A-Za-z_$][\w$]*)\s*$/.exec(part.trim());
      const plain = /^([A-Za-z_$][\w$]*)\s*$/.exec(part.trim());
      const name = alias?.[1] ?? plain?.[1];
      if (name !== undefined) names.push(name);
    }
  }
  // JS default / namespace bindings: `import x from …`, `import * as x from …`.
  const defaultBinding = /import\s+(?:\*\s+as\s+)?([A-Za-z_$][\w$]*)\s*(?:,|from)/.exec(statement);
  if (defaultBinding?.[1] !== undefined) names.push(defaultBinding[1]);
  // Python's bare `import m`, `import m as alias`, `import pkg.sub`. The alias binds when present;
  // otherwise it is the FIRST dotted segment that lands in scope (`import os.path` binds `os`).
  const pyImport = /^\s*import\s+([\w.]+)(?:\s+as\s+([A-Za-z_$][\w$]*))?\s*$/.exec(statement);
  if (pyImport !== null) {
    const alias = pyImport[2];
    const first = pyImport[1]?.split('.')[0];
    if (alias !== undefined) names.push(alias);
    else if (first !== undefined) names.push(first);
  }
  // Python `from m import a, b` (no braces).
  const pyFrom = /^\s*from\s+[\w.]+\s+import\s+(.+)$/.exec(statement);
  if (pyFrom?.[1] !== undefined) {
    for (const part of pyFrom[1].split(',')) {
      const alias = /(?:\bas\b\s+)([A-Za-z_$][\w$]*)\s*$/.exec(part.trim());
      const plain = /^([A-Za-z_$][\w$]*)\s*$/.exec(part.trim());
      const name = alias?.[1] ?? plain?.[1];
      if (name !== undefined) names.push(name);
    }
  }
  return [...new Set(names)];
}

/** Turn symbols into candidates, tagged with where they came from. */
export function toCandidates(
  symbols: readonly SymbolRef[],
  origin: CandidateOrigin,
): SymbolCandidate[] {
  return symbols.map((symbol) => ({ name: symbol.name, origin, location: symbol.location }));
}
