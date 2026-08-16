import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { GatePart } from '@fixora/core-ai';
import { neighbourRelevanceScore, type Finding, type Language } from '@fixora/shared-types';

/**
 * The main-side half of Repair Context Engine v3: turn the analyzer-selected context ranges into the
 * neighbour parts the prompt builder ranks, and assemble the Project Metadata layer.
 *
 * The WHICH — which imports and declarations are relevant — was decided by the AST selector at
 * analysis time and rides on the finding. Here we only slice the exact text (so the secret gate still
 * scans every byte) and read the project's own settings. Nothing is invented.
 */

/**
 * The finding's context as one ranked list of prompt neighbours.
 *
 * Same-file entries are sliced from `content`; cross-file entries arrive as already-resolved text
 * (never sliced — a foreign line range would cut the wrong file). Both are then scored by the SAME
 * `neighbourRelevanceScore` and sorted together, because this is the only place both kinds exist as
 * one list. Appending cross-file after same-file, as this did before, meant a foreign definition the
 * diagnostic explicitly names could still be dropped by the token budget in favour of a local
 * neighbour that merely happened to be nearby.
 */
export function repairNeighbours(content: string, finding: Finding): GatePart[] {
  const ranges = finding.evidence.contextRanges ?? [];
  const crossFile = finding.evidence.crossFileContext ?? [];
  if (ranges.length === 0 && crossFile.length === 0) return [];
  const lines = content.split('\n');
  const diagnosticText = `${finding.message}\n${finding.evidence.snippet}`;
  const findingLine = finding.location.startLine;

  const scored: { part: GatePart; score: number }[] = [];
  for (const r of ranges) {
    const text = lines.slice(r.startLine - 1, r.endLine).join('\n');
    if (text.trim() === '') continue;
    scored.push({
      part: { label: r.label, text },
      score: neighbourRelevanceScore(r.label, r.startLine, findingLine, diagnosticText),
    });
  }
  // `null` line: cross-file context has no position in THIS file, so it is scored on the reference
  // signal alone rather than on a line number it does not have.
  for (const entry of crossFile) {
    if (entry.text.trim() === '') continue;
    scored.push({
      part: { label: entry.label, text: entry.text },
      score: neighbourRelevanceScore(entry.label, null, findingLine, diagnosticText),
    });
  }

  // Stable sort: equal scores keep same-file-then-cross-file order, so this degrades exactly to the
  // previous behaviour when nothing scores differently.
  return scored.sort((a, b) => b.score - a.score).map((s) => s.part);
}

/** Read `compilerOptions.strict` from the workspace tsconfig, or null when there is none / unreadable. */
export function tsconfigStrict(workspaceRoot: string): boolean | null {
  const path = join(workspaceRoot, 'tsconfig.json');
  if (!existsSync(path)) return null;
  try {
    // tsconfig permits comments/trailing commas; a tolerant strip keeps this from throwing on real ones.
    const raw = readFileSync(path, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1')
      .replace(/,(\s*[}\]])/g, '$1');
    const parsed = JSON.parse(raw) as { compilerOptions?: { strict?: unknown } };
    return parsed.compilerOptions?.strict === true;
  } catch {
    return null;
  }
}

/**
 * The Project Metadata layer: the conventions a repair should respect, detected from the project rather
 * than assumed. React is inferred from a real `react` import in the file; strict mode from the
 * workspace tsconfig. Every line is a fact about THIS project, so the model tailors the fix to it.
 */
export function projectConventions(input: {
  language: Language;
  fileContent: string;
  workspaceRoot: string;
}): string[] {
  const conventions = [`Language: ${input.language}`];

  const importsReact =
    /(^|\n)\s*import[^\n]*from\s*['"]react['"]/.test(input.fileContent) ||
    /require\(\s*['"]react['"]\s*\)/.test(input.fileContent);
  if (importsReact) {
    conventions.push('Framework: React — obey the rules of hooks and keep JSX valid.');
  }

  if (input.language === 'typescript' && tsconfigStrict(input.workspaceRoot) === true) {
    conventions.push(
      'TypeScript strict mode is on — the fix must satisfy strict null/type checks.',
    );
  }

  conventions.push('Preserve the surrounding imports, code style, and public signatures.');
  return conventions;
}
