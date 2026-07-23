import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  buildContext,
  parseRepairOutput,
  prepareRequest,
  type AIProvider,
  type GatePart,
  type ProviderMessage,
  type ProviderRequest,
  type TargetRange,
  DEFAULT_BUDGETS,
} from '@fixora/core-ai';
import type { Finding, Language } from '@fixora/shared-types';

/**
 * The real AI "Generate Repair" leg, wired to the exact core-ai path the app runs:
 *
 *   buildContext → prepareRequest (secret gate + prompt) → provider.stream → parseRepairOutput
 *
 * The provider is INJECTED: at runtime the harness passes the real `createOpenRouterProvider`; a test
 * passes a fake `AIProvider` with a canned stream, which exercises this whole orchestration (context,
 * prompt, streaming accumulation, JSON recovery, the one re-ask) WITHOUT a key or a network — so "the
 * wiring is real" is proven by test, and only the live model numbers are DEFERRED behind a key.
 *
 * The context helpers below are faithful copies of apps/desktop/electron/main/ai/repair-context.ts and
 * the splice of verification/patch.ts. They are pure (no Electron), and are duplicated rather than
 * imported because a tooling package must not depend on the desktop app. If either original changes,
 * these must follow — a drift test guards the splice's line-ending behaviour.
 */

// --- faithful copies of the app's pure context assembly (repair-context.ts) ---

/** Slice the finding's analyzer-selected context ranges out of the file, as ranked neighbour parts. */
export function repairNeighbours(content: string, finding: Finding): GatePart[] {
  const ranges = finding.evidence.contextRanges ?? [];
  if (ranges.length === 0) return [];
  const lines = content.split('\n');
  const parts: GatePart[] = [];
  for (const r of ranges) {
    const text = lines.slice(r.startLine - 1, r.endLine).join('\n');
    if (text.trim() !== '') parts.push({ label: r.label, text });
  }
  return parts;
}

function tsconfigStrict(workspaceRoot: string): boolean | null {
  const path = join(workspaceRoot, 'tsconfig.json');
  if (!existsSync(path)) return null;
  try {
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

/** The Project Metadata layer — conventions detected from THIS project, never assumed. */
export function projectConventions(input: {
  language: Language;
  fileContent: string;
  workspaceRoot: string;
}): string[] {
  const conventions = [`Language: ${input.language}`];
  const importsReact =
    /(^|\n)\s*import[^\n]*from\s*['"]react['"]/.test(input.fileContent) ||
    /require\(\s*['"]react['"]\s*\)/.test(input.fileContent);
  if (importsReact)
    conventions.push('Framework: React — obey the rules of hooks and keep JSX valid.');
  if (input.language === 'typescript' && tsconfigStrict(input.workspaceRoot) === true) {
    conventions.push(
      'TypeScript strict mode is on — the fix must satisfy strict null/type checks.',
    );
  }
  conventions.push('Preserve the surrounding imports, code style, and public signatures.');
  return conventions;
}

// --- faithful copy of the CRLF-aware splice (verification/patch.ts) ---

function dominantEol(content: string): '\r\n' | '\n' {
  const total = (content.match(/\n/g) ?? []).length;
  const crlf = (content.match(/\r\n/g) ?? []).length;
  return total > 0 && crlf * 2 >= total ? '\r\n' : '\n';
}

/** Replace a 1-based inclusive line range with `replacement`, normalising to the file's own EOL. */
export function spliceLines(
  content: string,
  startLine: number,
  endLine: number,
  replacement: string,
): string {
  const eol = dominantEol(content);
  const lines = content.split(/\r?\n/);
  const before = lines.slice(0, Math.max(0, startLine - 1));
  const after = lines.slice(endLine);
  return [...before, ...replacement.split(/\r?\n/), ...after].join(eol);
}

// --- the generate orchestration ---

/** Where a generation attempt terminated — the acceptance taxonomy for the model-facing stages. */
export type GenerateFailureSubsystem =
  'context-builder' | 'prompt-builder' | 'ai-provider' | 'response-parser';

export type GenerateResult =
  | {
      ok: true;
      /** The model's replacement for the target range only. */
      repairedCode: string;
      /** The full file after splicing `repairedCode` into the target range. */
      patched: string;
      rationale: string;
      confidence: number;
      /** JSON-recovery steps the parser had to apply (empty/‘none’ when the output was clean). */
      recovery: readonly string[];
      /** Whether the valid output came only after the schema re-ask. */
      reAsked: boolean;
    }
  | {
      ok: false;
      subsystem: GenerateFailureSubsystem;
      reason: string;
    };

export interface GenerateInput {
  provider: AIProvider;
  model: string;
  finding: Finding;
  language: Language;
  fileContent: string;
  workspaceRoot: string;
  target: TargetRange;
  signal?: AbortSignal;
}

async function streamText(
  provider: AIProvider,
  request: ProviderRequest,
  signal: AbortSignal,
): Promise<{ ok: true; text: string } | { ok: false; reason: string }> {
  let text = '';
  for await (const event of provider.stream(request, signal)) {
    if (event.type === 'text_delta') text += event.text;
    else if (event.type === 'error') {
      return {
        ok: false,
        reason:
          event.message.trim() === ''
            ? `provider error (${event.providerCode})`
            : `${event.message} (${event.providerCode})`,
      };
    }
  }
  return { ok: true, text };
}

/** The app's exact schema re-ask: append the bad answer + a demand for JSON only, then stream again. */
function reAskRequest(request: ProviderRequest, previous: string): ProviderRequest {
  const messages: ProviderMessage[] = [
    ...request.messages,
    { role: 'assistant', content: previous },
    {
      role: 'user',
      content:
        'Your previous response was not valid JSON matching the required schema. ' +
        'Return ONLY the JSON object, with no surrounding text.',
    },
  ];
  return { ...request, messages };
}

export async function generateRepair(input: GenerateInput): Promise<GenerateResult> {
  const signal = input.signal ?? new AbortController().signal;

  // Context extraction (v3 layers) + the secret gate, exactly as prepareRequest enforces it.
  const context = buildContext({
    filePath: input.finding.location.file,
    language: input.language,
    fileContent: input.fileContent,
    finding: input.finding,
    target: input.target,
    neighbours: repairNeighbours(input.fileContent, input.finding),
    conventions: projectConventions({
      language: input.language,
      fileContent: input.fileContent,
      workspaceRoot: input.workspaceRoot,
    }),
    budget: DEFAULT_BUDGETS.repair,
  });

  const prepared = prepareRequest('repair', context, {
    model: input.model,
    maxOutputTokens: DEFAULT_BUDGETS.repair.reserveForOutput,
  });
  if (!prepared.ok) {
    const where = prepared.blocked.map((m) => `${m.rule}@${m.label}`).join(', ');
    return {
      ok: false,
      subsystem: 'prompt-builder',
      reason: `secret gate blocked the request before send (${where}) — nothing was sent to the provider`,
    };
  }

  // Stream once; on a parse failure, re-ask exactly once (the app's contract).
  const first = await streamText(input.provider, prepared.request, signal);
  if (!first.ok) return { ok: false, subsystem: 'ai-provider', reason: first.reason };

  let text = first.text;
  let reAsked = false;
  let parsed = parseRepairOutput(text);
  if (!parsed.ok) {
    reAsked = true;
    const retry = await streamText(input.provider, reAskRequest(prepared.request, text), signal);
    if (!retry.ok) return { ok: false, subsystem: 'ai-provider', reason: retry.reason };
    text = retry.text;
    parsed = parseRepairOutput(text);
  }
  if (!parsed.ok) {
    return {
      ok: false,
      subsystem: 'response-parser',
      reason: `model output did not match the repair schema after a re-ask: ${parsed.reason} — ${parsed.detail}`,
    };
  }

  const patched = spliceLines(
    input.fileContent,
    input.target.startLine,
    input.target.endLine,
    parsed.value.repairedCode,
  );
  return {
    ok: true,
    repairedCode: parsed.value.repairedCode,
    patched,
    rationale: parsed.value.rationale,
    confidence: parsed.value.confidence,
    recovery: parsed.recovery,
    reAsked,
  };
}
