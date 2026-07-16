import type { TaskProfile } from '@fixora/shared-types';

import type { BuiltContext } from '../context/context-builder.js';
import type { ProviderMessage, ProviderRequest, ResponseSchema } from '../provider/types.js';

import { REPAIR_JSON_SCHEMA, TEST_JSON_SCHEMA } from './schemas.js';

/**
 * Task profiles (AI-Pipeline §5). Each profile is the *policy* for one kind of request: its system
 * prompt, whether it wants schema-constrained structured output, and its sampling temperature. The
 * user message is built the same way for all three — from the grounded context — so the model always
 * reasons over the same evidence and only the instruction differs.
 *
 * `repair` and `test` are low-temperature and schema-constrained (they write code). `explain` is prose.
 */

interface ProfileDef {
  readonly system: string;
  readonly responseSchema?: ResponseSchema;
  readonly temperature: number;
}

const REPAIR_SYSTEM = [
  'You are Fixora, a verified code-repair engine. You fix exactly one grounded finding by rewriting',
  'ONLY the target symbol you are given. You never touch code outside it and never rewrite the whole',
  'file. Preserve the surrounding style, indentation, and the public signature unless the fix requires',
  'changing it. Return JSON matching the schema: `repairedCode` is the complete replacement for the',
  'target symbol (not a diff, not the whole file); `rationale` explains why the original was wrong and',
  'how the fix resolves the finding; `confidence` is your honest 0–1 estimate. No prose outside the JSON.',
].join(' ');

const EXPLAIN_SYSTEM = [
  'You are Fixora. Explain the given finding to a working developer: what it means, why it matters in',
  'this code, and the concrete way to fix it. Be specific to the code shown, not generic. Concise',
  'markdown. Do not propose a full rewrite — this is an explanation, not a patch.',
].join(' ');

const TEST_SYSTEM = [
  'You are Fixora. Write a single focused test for the target symbol that pins the behaviour implicated',
  'by the finding — one that fails against the buggy code and passes once it is correctly fixed. Use the',
  "project's existing test framework if one is given. Return JSON matching the schema: `framework`,",
  '`testCode` (one self-contained test file), and `rationale`. No prose outside the JSON.',
].join(' ');

const PROFILES: Record<TaskProfile, ProfileDef> = {
  repair: { system: REPAIR_SYSTEM, responseSchema: REPAIR_JSON_SCHEMA, temperature: 0.1 },
  explain: { system: EXPLAIN_SYSTEM, temperature: 0.3 },
  test: { system: TEST_SYSTEM, responseSchema: TEST_JSON_SCHEMA, temperature: 0.1 },
};

function buildUserMessage(context: BuiltContext): string {
  const sections: string[] = [];
  sections.push(`Language: ${context.language}`);
  sections.push(`File: ${context.filePath}`);
  if (context.conventions.length > 0) {
    sections.push(`Project conventions:\n${context.conventions.join('\n')}`);
  }
  sections.push(`Finding to address:\n${context.evidenceText}`);

  const symbolLabel = context.target.symbolName ?? '(top-level code)';
  sections.push(
    `Target symbol \`${symbolLabel}\` ` +
      `(lines ${String(context.target.startLine)}–${String(context.target.endLine)}):\n` +
      context.target.text,
  );

  if (context.neighbours.length > 0) {
    const neighbourText = context.neighbours
      .map((n) => `// ${n.label}\n${n.text}`)
      .join('\n\n');
    sections.push(`Related context:\n${neighbourText}`);
  }

  return sections.join('\n\n');
}

export interface BuildRequestOptions {
  readonly model: string;
  readonly maxOutputTokens?: number;
}

/**
 * Turn a profile + grounded context into a provider request. This is pure — no network, no key. The
 * gate runs before this is ever handed to a provider (see pipeline/prepare.ts).
 */
export function buildProviderRequest(
  profile: TaskProfile,
  context: BuiltContext,
  options: BuildRequestOptions,
): ProviderRequest {
  const def = PROFILES[profile];
  const messages: ProviderMessage[] = [
    { role: 'system', content: def.system },
    { role: 'user', content: buildUserMessage(context) },
  ];
  return {
    model: options.model,
    messages,
    temperature: def.temperature,
    ...(options.maxOutputTokens !== undefined ? { maxOutputTokens: options.maxOutputTokens } : {}),
    ...(def.responseSchema !== undefined ? { responseSchema: def.responseSchema } : {}),
  };
}

export function profileWantsStructuredOutput(profile: TaskProfile): boolean {
  return PROFILES[profile].responseSchema !== undefined;
}
