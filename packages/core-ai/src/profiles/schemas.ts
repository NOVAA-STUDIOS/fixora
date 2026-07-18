import { RepairOutputSchema, TestOutputSchema } from '@fixora/shared-types';
import type { z } from 'zod';

import type { ResponseSchema } from '../provider/types.js';

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

export type ParseResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: 'not-json' | 'schema-mismatch' };

function parseWith<T>(schema: z.ZodType<T>, raw: string): ParseResult<T> {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, reason: 'not-json' };
  }
  const result = schema.safeParse(json);
  return result.success
    ? { ok: true, value: result.data }
    : { ok: false, reason: 'schema-mismatch' };
}

export function parseRepairOutput(raw: string): ParseResult<z.infer<typeof RepairOutputSchema>> {
  return parseWith(RepairOutputSchema, raw);
}

export function parseTestOutput(raw: string): ParseResult<z.infer<typeof TestOutputSchema>> {
  return parseWith(TestOutputSchema, raw);
}
