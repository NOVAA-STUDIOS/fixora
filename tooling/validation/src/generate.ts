import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  buildContext,
  buildReAskMessage,
  parseRepairOutput,
  prepareRequest,
  type AIProvider,
  type GatePart,
  type ProviderMessage,
  type ProviderRequest,
  type TargetRange,
  DEFAULT_BUDGETS,
} from '@fixora/core-ai';
import { neighbourRelevanceScore, type Finding, type Language } from '@fixora/shared-types';

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

/** The finding's context as one ranked list of prompt neighbours — see repair-context.ts for why
 * same-file and cross-file candidates are scored together rather than same-file-then-appended. */
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
  // Cross-file context is already-resolved text, never sliced from `content` — see the app-side
  // copy in repair-context.ts for why a line range would slice the wrong file. `null` line: it has
  // no position in THIS file, so it is scored on the reference signal alone.
  for (const entry of crossFile) {
    if (entry.text.trim() === '') continue;
    scored.push({
      part: { label: entry.label, text: entry.text },
      score: neighbourRelevanceScore(entry.label, null, findingLine, diagnosticText),
    });
  }

  return scored.sort((a, b) => b.score - a.score).map((s) => s.part);
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
      /** The exact request sent — carried so a caller can build a verification-failure follow-up
       * against the SAME conversation, the way ai-service.ts's retry loop does. */
      request: ProviderRequest;
      lastText: string;
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

/** Same policy as core-ai's runWithFailover (1s, then 2s) — duplicated for the same reason this
 * whole file is: a tooling package must not depend on the desktop app, and this harness has no
 * provider chain to fail over across, only one provider to retry against. */
const RETRY_BACKOFF_MS: readonly number[] = [1000, 2000];

const delay = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      resolve();
    });
  });

async function streamOnce(
  provider: AIProvider,
  request: ProviderRequest,
  signal: AbortSignal,
): Promise<
  { ok: true; text: string } | { ok: false; reason: string; retryable: boolean }
> {
  let text = '';
  for await (const event of provider.stream(request, signal)) {
    if (event.type === 'text_delta') text += event.text;
    else if (event.type === 'error') {
      return {
        ok: false,
        retryable: event.retryable,
        reason:
          event.message.trim() === ''
            ? `provider error (${event.providerCode})`
            : `${event.message} (${event.providerCode})`,
      };
    }
  }
  return { ok: true, text };
}

/**
 * `streamOnce`, retried up to twice (1s, then 2s) when the failure is a burst rate limit, a
 * timeout, a 5xx, or a dropped connection (`retryable: true` — failure.ts) — never for an
 * exhausted-quota 429 or a bad key, which `retryable: false` marks as pointless to repeat.
 * Each retry is logged so a validation run shows exactly when and why it paused.
 */
async function streamText(
  provider: AIProvider,
  request: ProviderRequest,
  signal: AbortSignal,
): Promise<{ ok: true; text: string } | { ok: false; reason: string }> {
  let result = await streamOnce(provider, request, signal);
  for (
    let i = 0;
    !result.ok && result.retryable && i < RETRY_BACKOFF_MS.length && !signal.aborted;
    i += 1
  ) {
    const delayMs = RETRY_BACKOFF_MS[i] as number;
    console.error('[validation] retrying after a retryable provider failure', {
      attempt: i + 1,
      delayMs,
      reason: result.reason,
    });
    await delay(delayMs, signal);
    if (signal.aborted) break;
    result = await streamOnce(provider, request, signal);
  }
  return result.ok ? result : { ok: false, reason: result.reason };
}

/** The app's exact schema re-ask — `buildReAskMessage`, reason-aware (empty/truncated/schema-
 * mismatch each get their own instruction), not a hand-duplicated generic string. */
function reAskRequest(
  request: ProviderRequest,
  previous: string,
  failure: { reason: string; detail: string } = { reason: 'unknown', detail: '' },
): ProviderRequest {
  const messages: ProviderMessage[] = [
    ...request.messages,
    { role: 'assistant', content: previous },
    { role: 'user', content: buildReAskMessage(failure) },
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
    const retry = await streamText(
      input.provider,
      reAskRequest(prepared.request, text, { reason: parsed.reason, detail: parsed.detail }),
      signal,
    );
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
    request: prepared.request,
    lastText: text,
  };
}

/**
 * A verification-failure retry: the app's `buildVerificationReAskMessage`, sent as a follow-up to
 * the SAME conversation an earlier `generateRepair` call started — the request/lastText it returned.
 * Never a fresh request: continuing the conversation is what lets the model see its own prior,
 * REJECTED answer alongside the reason it was rejected, exactly as ai-service.ts's retry loop does.
 */
export async function reAskAfterVerification(
  provider: AIProvider,
  previousRequest: ProviderRequest,
  previousText: string,
  verificationMessage: string,
  targetStartLine: number,
  targetEndLine: number,
  fileContent: string,
  signal: AbortSignal,
): Promise<GenerateResult> {
  const messages: ProviderMessage[] = [
    ...previousRequest.messages,
    { role: 'assistant', content: previousText },
    { role: 'user', content: verificationMessage },
  ];
  const request: ProviderRequest = { ...previousRequest, messages };

  const stream = await streamText(provider, request, signal);
  if (!stream.ok) return { ok: false, subsystem: 'ai-provider', reason: stream.reason };

  let text = stream.text;
  let reAsked = false;
  let parsed = parseRepairOutput(text);
  if (!parsed.ok) {
    reAsked = true;
    const retry = await streamText(
      provider,
      reAskRequest(request, text, { reason: parsed.reason, detail: parsed.detail }),
      signal,
    );
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

  return {
    ok: true,
    repairedCode: parsed.value.repairedCode,
    patched: spliceLines(fileContent, targetStartLine, targetEndLine, parsed.value.repairedCode),
    rationale: parsed.value.rationale,
    confidence: parsed.value.confidence,
    recovery: parsed.recovery,
    reAsked,
    request,
    lastText: text,
  };
}
