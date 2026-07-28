import {
  buildEditContext,
  classifyIntent,
  describeModelOutputFailure,
  describeProviderFailure,
  parseEditOutput,
  prepareEditRequest,
  type AIProvider,
  type ProviderFailure,
  type ProviderMessage,
  type ProviderRequest,
} from '@fixora/core-ai';
import type { EditScope } from '@fixora/core-analysis';
import type {
  Finding,
  Language,
  ProceedOutcome,
  ProceedRunRequest,
  VerificationReport,
} from '@fixora/shared-types';

import type { VerifyInput } from '../verification/verification-service.js';

/**
 * Proceed Mode orchestration (P2.1, objectives 1, 6, 7, 9).
 *
 * Turns a natural-language instruction into a VERIFIED edit proposal by composing the pieces the
 * repair engine already ships: the deterministic intent classifier and editing context/prompt/gate
 * (core-ai), AST scope selection (core-analysis, injected because it lives in the worker), and the
 * REAL verification service (parser → analyzer → verifier → compile → re-analyze → regression). It
 * NEVER bypasses verification and NEVER returns an edit that failed it (safe apply). Every dependency
 * is injected, so the whole flow is unit-testable without Electron, the worker, or the network.
 */

/** A single structured log line. It records the decision, never the source code or any key. */
export interface ProceedLogEntry {
  event: 'run';
  intent: string;
  language: string | null;
  /** How the target scope was chosen, and its size in lines — never its contents. */
  scope: { basis: EditScope['basis']; lines: number } | null;
  verdict: VerificationReport['verdict'] | null;
  applied: boolean;
  outcome: ProceedOutcome['status'];
  /** Machine-readable reason for a non-ok outcome. Never a source snippet. */
  rejectionReason: string | null;
  /** Instruction LENGTH only — the text itself is user content and is not logged. */
  instructionChars: number;
}

export interface ProceedDeps {
  provider: AIProvider;
  model: string;
  maxOutputTokens?: number;
  workspaceRoot: string;
  /** Read the current file content. */
  readSource: (file: string) => string;
  /** Path → language, without importing the tree-sitter engine into main (CJS boundary). */
  detectLanguage: (file: string) => Language | null;
  /** Resolve the smallest enclosing scope (worker-backed; core-analysis lives in the utility process). */
  resolveScope: (input: {
    source: string;
    language: Language;
    filePath: string;
    selectionStartLine: number;
    selectionEndLine?: number;
  }) => Promise<EditScope>;
  /** The file's current findings — the regression baseline the verifier compares against. */
  baselineFindings: (file: string) => Promise<readonly Finding[]>;
  /** The REAL verification service — reused, never re-implemented. */
  verify: (input: VerifyInput) => Promise<{ report: VerificationReport; originalCode: string }>;
  /** Detected project conventions for the edit prompt (optional). */
  conventions?: (input: { language: Language; fileContent: string }) => readonly string[];
  log: (entry: ProceedLogEntry) => void;
}

export interface ProceedService {
  run(request: ProceedRunRequest, signal: AbortSignal): Promise<ProceedOutcome>;
}

/** The app's exact schema re-ask (shared discipline with repair): demand JSON only, once. */
function reAsk(request: ProviderRequest, previous: string): ProviderRequest {
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

async function stream(
  provider: AIProvider,
  request: ProviderRequest,
  signal: AbortSignal,
): Promise<{ ok: true; text: string } | { ok: false; failure: ProviderFailure }> {
  let text = '';
  for await (const event of provider.stream(request, signal)) {
    if (event.type === 'text_delta') text += event.text;
    else if (event.type === 'error') {
      // Classified, not echoed: the user gets "your quota is exhausted", not "429 Too Many Requests".
      return {
        ok: false,
        failure: describeProviderFailure({
          providerCode: event.providerCode,
          detail: event.message,
          retryable: event.retryable,
        }),
      };
    }
  }
  return { ok: true, text };
}

export function createProceedService(deps: ProceedDeps): ProceedService {
  return {
    async run(request, signal): Promise<ProceedOutcome> {
      const base = {
        event: 'run' as const,
        instructionChars: request.instruction.length,
        intent: 'unknown' as string,
        language: null as string | null,
        scope: null as ProceedLogEntry['scope'],
        verdict: null as VerificationReport['verdict'] | null,
        applied: false,
      };
      const done = (o: ProceedOutcome, reason: string | null): ProceedOutcome => {
        deps.log({ ...base, outcome: o.status, rejectionReason: reason });
        return o;
      };

      // 1) Language first — an unsupported file type is unsupported whatever the instruction says,
      //    and the language is what disambiguates the intent below (a .py file is never a TS edit).
      const language = deps.detectLanguage(request.file);
      base.language = language;
      if (language === null) {
        return done(
          {
            status: 'error',
            code: 'unsupported_language',
            message: 'This file type is not supported for editing.',
          },
          'unsupported-language',
        );
      }

      // 2) Intent — deterministic, biased by the real file language. Unknown fails gracefully, and so
      //    does `explanation`: a question ("explain what this does") is not an edit request, and must
      //    never reach scope resolution or the provider — Proceed only ever produces edits.
      const { intent } = classifyIntent(request.instruction, { language });
      base.intent = intent;
      if (intent === 'unknown' || intent === 'explanation') {
        return done(
          {
            status: 'unknown-intent',
            message:
              intent === 'explanation'
                ? 'That reads like a question, not a change to make. Proceed only performs edits — ' +
                  'try describing what to change instead, e.g. "make this button green".'
                : 'I could not tell what kind of change you want. Try naming the change, e.g. ' +
                  '"make this button green" or "rename this variable".',
          },
          intent === 'explanation' ? 'explanation-intent' : 'unknown-intent',
        );
      }

      const source = deps.readSource(request.file);
      const scope = await deps.resolveScope({
        source,
        language,
        filePath: request.file,
        selectionStartLine: request.selectionStartLine,
        ...(request.selectionEndLine !== undefined
          ? { selectionEndLine: request.selectionEndLine }
          : {}),
      });
      base.scope = { basis: scope.basis, lines: scope.endLine - scope.startLine + 1 };

      // 3) Context + gated prompt — nothing leaves without the secret gate.
      const conventions = deps.conventions?.({ language, fileContent: source });
      const context = buildEditContext({
        instruction: request.instruction,
        intent,
        filePath: request.file,
        language,
        target: {
          symbolName: scope.symbolName,
          startLine: scope.startLine,
          endLine: scope.endLine,
          text: scope.text,
        },
        ...(conventions !== undefined ? { conventions } : {}),
      });
      const prepared = prepareEditRequest(context, {
        model: deps.model,
        ...(deps.maxOutputTokens !== undefined ? { maxOutputTokens: deps.maxOutputTokens } : {}),
      });
      if (!prepared.ok) {
        return done(
          { status: 'blocked', matches: prepared.blocked.map((m) => ({ ...m })) },
          'secret-gate-blocked',
        );
      }

      // Every failure below carries the same diagnostic tail: what we detected, and what to try. A
      // failed edit must never leave the user guessing which of intent / language / model went wrong.
      const failed = (failure: ProviderFailure): ProceedOutcome => ({
        status: 'error',
        code: failure.kind,
        message: `${failure.message}\n\nDetected intent: ${intent} · language: ${language}${
          failure.retryable ? '\nYou can retry this request.' : ''
        }`,
        retryable: failure.retryable,
      });

      // 4) Generate — stream + one schema re-ask, exactly like repair.
      let out = await stream(deps.provider, prepared.request, signal);
      // A cancelled stream ends cleanly with no text (AI-Pipeline §6) rather than throwing or failing,
      // so it must be checked explicitly here — otherwise an aborted request falls through to
      // `parseEditOutput('')`, fails to parse, and surfaces as a confusing "invalid model output"
      // error instead of the clean cancellation it actually was (Q3 Defect #4, mirrors ai-service.ts).
      if (signal.aborted) {
        return done({ status: 'error', code: 'cancelled', message: 'Cancelled.' }, 'cancelled');
      }
      if (!out.ok)
        return done(failed(out.failure), `${out.failure.kind}:${out.failure.providerCode}`);
      let parsed = parseEditOutput(out.text);
      if (!parsed.ok) {
        out = await stream(deps.provider, reAsk(prepared.request, out.text), signal);
        if (!out.ok)
          return done(failed(out.failure), `${out.failure.kind}:${out.failure.providerCode}`);
        parsed = parseEditOutput(out.text);
      }
      if (!parsed.ok) {
        const failure = describeModelOutputFailure(parsed.reason, parsed.detail);
        return done(failed(failure), `model-output:${parsed.reason}`);
      }

      // TEMP-DIAGNOSTIC (Q3 file-corruption incident — remove after root cause). Gated on the
      // disposable repro filename so no other file's content is ever logged. Captures the model's
      // editedCode exactly as parsed, before it crosses back to the renderer over `proceed:run`.
      if (request.file.includes('proceed-diag')) {
        const ec = parsed.value.editedCode;
        const nulCount = ec.split(String.fromCharCode(0)).length - 1;
        console.error('[Q3-DIAG] proceed-service: parsed editedCode', {
          file: request.file,
          typeofEditedCode: typeof ec,
          length: ec.length,
          byteLength: Buffer.byteLength(ec, 'utf8'),
          containsNul: nulCount > 0,
          nulCount,
          preview: JSON.stringify(ec.slice(0, 60)),
        });
      }

      // 5) Verify — the REAL pipeline, in EDIT mode (finding: null). Never bypassed.
      const originalFindings = await deps.baselineFindings(request.file);
      const { report, originalCode } = await deps.verify({
        finding: null,
        repairedCode: parsed.value.editedCode,
        target: {
          file: request.file,
          startLine: scope.startLine,
          endLine: scope.endLine,
          language,
        },
        workspaceRoot: deps.workspaceRoot,
        originalContent: source,
        originalFindings,
      });
      base.verdict = report.verdict;

      // 6) Safe apply gate — a regression is refused; the edit is never applied.
      if (report.verdict === 'regression') {
        return done(
          {
            status: 'rejected',
            reason: report.note ?? 'The edit did not pass verification.',
            verification: report,
          },
          `regression:${String(report.newFindingCount)}`,
        );
      }

      return done(
        {
          status: 'ok',
          proposal: {
            intent,
            editedCode: parsed.value.editedCode,
            originalCode,
            summary: parsed.value.summary,
            confidence: parsed.value.confidence,
            target: {
              file: request.file,
              startLine: scope.startLine,
              endLine: scope.endLine,
              symbolName: scope.symbolName,
            },
            verification: report,
          },
        },
        null,
      );
    },
  };
}
