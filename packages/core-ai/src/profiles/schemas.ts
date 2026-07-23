import { EditOutputSchema, RepairOutputSchema, TestOutputSchema } from '@fixora/shared-types';
import type { z } from 'zod';

import type { ResponseSchema } from '../provider/types.js';

import { extractJson, type RecoveryStep } from './extract.js';

/**
 * Schema-constrained output (AI-Pipeline §3). The model is asked for JSON matching a schema via the
 * provider's native mechanism — we do **not** scrape markdown fences with a regex, which is silent,
 * undetectable corruption in a system that writes to people's source files. Two representations, kept
 * in lockstep by a test: the JSON Schema the provider enforces, and the zod schema we validate the
 * returned text against on our side. On a violation: one automatic re-ask, then a loud typed failure —
 * never best-effort.
 */

/** The JSON Schema the provider is told to conform to (strict, no extra keys). */
export const REPAIR_JSON_SCHEMA: ResponseSchema = {
  name: 'repair',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['repairedCode', 'rationale', 'confidence'],
    properties: {
      repairedCode: {
        type: 'string',
        description: 'The full replacement source for the target symbol only. No surrounding file.',
      },
      rationale: {
        type: 'string',
        description: 'Why the original was wrong and how this fixes it.',
      },
      confidence: { type: 'number', minimum: 0, maximum: 1 },
    },
  },
};

export const TEST_JSON_SCHEMA: ResponseSchema = {
  name: 'test',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['framework', 'testCode', 'rationale'],
    properties: {
      framework: { type: 'string', description: "The test framework, e.g. 'vitest', 'pytest'." },
      testCode: { type: 'string', description: 'A single focused test file.' },
      rationale: { type: 'string' },
    },
  },
};

/** Proceed Mode's structured edit output (P2.1). Same contract discipline as repair — no fence-scraping. */
export const EDIT_JSON_SCHEMA: ResponseSchema = {
  name: 'edit',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['editedCode', 'summary', 'confidence'],
    properties: {
      editedCode: {
        type: 'string',
        description: 'The full replacement source for the target scope only. No surrounding file.',
      },
      summary: { type: 'string', description: 'One or two sentences: exactly what changed and why.' },
      confidence: { type: 'number', minimum: 0, maximum: 1 },
    },
  },
};

/**
 * Why a parse failed, precisely enough to act on.
 *
 * The old union was `'not-json' | 'schema-mismatch'`, which the UI rendered as "The model returned
 * an invalid response." for every case. That single sentence covered a truncated reply, a prose
 * answer, a fenced object and a missing field — four different problems with four different fixes,
 * and the user could not tell which they had.
 */
export type ParseFailure =
  'empty' | 'no-json-object' | 'truncated' | 'malformed-json' | 'schema-mismatch';

export type ParseResult<T> =
  | {
      readonly ok: true;
      readonly value: T;
      /** Which unwrapping steps fired. `['none']` means the model returned clean JSON. */
      readonly recovery: readonly RecoveryStep[];
    }
  | {
      readonly ok: false;
      readonly reason: ParseFailure;
      /** One sentence a human can act on. Never "invalid response". */
      readonly detail: string;
      /** Which fields the schema rejected, when that is the reason. */
      readonly issues?: readonly string[];
      /** What we tried to parse, after recovery. Written to the debug file on failure. */
      readonly text: string;
      readonly recovery: readonly RecoveryStep[];
    };

function parseWith<T>(schema: z.ZodType<T>, raw: string): ParseResult<T> {
  const extracted = extractJson(raw);
  if (!extracted.ok) {
    return {
      ok: false,
      reason: extracted.reason,
      detail: extracted.detail,
      text: extracted.text,
      recovery: [],
    };
  }

  const result = schema.safeParse(extracted.json);
  if (result.success) return { ok: true, value: result.data, recovery: extracted.recovery };

  // Name the fields. "missing repairedCode" is actionable; "schema-mismatch" is not.
  const issues = result.error.issues.map(
    (i) => `${i.path.length === 0 ? '(root)' : i.path.join('.')}: ${i.message}`,
  );
  return {
    ok: false,
    reason: 'schema-mismatch',
    detail: `The response was valid JSON but did not match the required shape — ${issues.join('; ')}`,
    issues,
    text: extracted.text,
    recovery: extracted.recovery,
  };
}

export function parseRepairOutput(raw: string): ParseResult<z.infer<typeof RepairOutputSchema>> {
  return parseWith(RepairOutputSchema, raw);
}

export function parseTestOutput(raw: string): ParseResult<z.infer<typeof TestOutputSchema>> {
  return parseWith(TestOutputSchema, raw);
}

export function parseEditOutput(raw: string): ParseResult<z.infer<typeof EditOutputSchema>> {
  return parseWith(EditOutputSchema, raw);
}
