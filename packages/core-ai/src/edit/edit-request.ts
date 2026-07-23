import { gate, type GateMatch } from '../gate/secret-gate.js';
import { EDIT_JSON_SCHEMA } from '../profiles/schemas.js';
import type { ProviderMessage, ProviderRequest } from '../provider/types.js';

import type { EditContext } from './edit-context.js';

/**
 * The editing prompt + request builder (Proceed Mode, objective 5).
 *
 * Mirrors the repair pipeline's `prepareRequest`: the SAME secret gate runs over the assembled parts
 * before anything can become a provider request, so "nothing leaves without passing the gate" holds
 * for edits exactly as it does for repairs (this is a structural property, not a convention). The
 * system prompt is tuned for edits — describe the task, preserve everything not asked to change, edit
 * ONLY the target scope, return structured JSON — but it deliberately does not expand the command
 * surface (that is a later milestone).
 */

const EDIT_SYSTEM = [
  'You are Fixora in Proceed Mode: an intelligent, verified code editor. You are given ONE target',
  'scope (a symbol, function, component, or CSS block) and a natural-language instruction. Apply the',
  'instruction to the target scope ONLY. Do not touch anything outside it, and never return the whole',
  'file. Preserve exactly: the surrounding formatting and indentation, the existing imports, the public',
  'signature (unless the instruction explicitly requires changing it), and the project conventions you',
  'are given. Make the smallest change that satisfies the instruction — no unrelated edits, no',
  'refactoring you were not asked for. Return JSON matching the schema: `editedCode` is the complete',
  'replacement for the target scope (not a diff, not the whole file); `summary` states exactly what you',
  'changed and why; `confidence` is your honest 0–1 estimate. No prose outside the JSON.',
].join(' ');

function buildEditUserMessage(context: EditContext): string {
  const sections: string[] = [];
  sections.push(`Language: ${context.language}`);
  sections.push(`File: ${context.filePath}`);
  sections.push(`Detected intent: ${context.intent}`);
  if (context.conventions.length > 0) {
    sections.push(`Project conventions (obey these):\n${context.conventions.join('\n')}`);
  }
  sections.push(`Instruction:\n${context.instruction}`);

  const symbolLabel = context.target.symbolName ?? '(selected block)';
  sections.push(
    `Target scope \`${symbolLabel}\` ` +
      `(lines ${String(context.target.startLine)}–${String(context.target.endLine)}) — edit THIS only:\n` +
      context.target.text,
  );

  if (context.neighbours.length > 0) {
    const neighbourText = context.neighbours.map((n) => `// ${n.label}\n${n.text}`).join('\n\n');
    sections.push(`Related context (read-only, do not edit):\n${neighbourText}`);
  }
  return sections.join('\n\n');
}

export interface BuildEditRequestOptions {
  readonly model: string;
  readonly maxOutputTokens?: number;
}

/** Pure: an edit context + options → a schema-constrained provider request. No network, no key. */
export function buildEditRequest(
  context: EditContext,
  options: BuildEditRequestOptions,
): ProviderRequest {
  const messages: ProviderMessage[] = [
    { role: 'system', content: EDIT_SYSTEM },
    { role: 'user', content: buildEditUserMessage(context) },
  ];
  return {
    model: options.model,
    messages,
    temperature: 0.1,
    ...(options.maxOutputTokens !== undefined ? { maxOutputTokens: options.maxOutputTokens } : {}),
    responseSchema: EDIT_JSON_SCHEMA,
  };
}

export type PreparedEdit =
  | { readonly ok: false; readonly blocked: readonly GateMatch[] }
  | { readonly ok: true; readonly request: ProviderRequest };

/**
 * The single path from an edit context to a provider request — and the reason the gate cannot be
 * bypassed for edits any more than it can for repairs. The gate scans every part first; a block
 * returns the matches so the caller can tell the user exactly what stopped the send.
 */
export function prepareEditRequest(
  context: EditContext,
  options: BuildEditRequestOptions,
): PreparedEdit {
  const gateResult = gate(context.parts);
  if (!gateResult.ok) return { ok: false, blocked: gateResult.matches };
  return { ok: true, request: buildEditRequest(context, options) };
}
