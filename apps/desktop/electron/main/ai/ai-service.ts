import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  buildContext,
  createOpenRouterProvider,
  describeProviderFailure,
  DEFAULT_BUDGETS,
  OPENROUTER_ENDPOINT,
  parseRepairOutput,
  parseTestOutput,
  prepareRequest,
  profileWantsStructuredOutput,
  type AIProvider,
  type ProviderMessage,
  type ProviderRequest,
} from '@fixora/core-ai';
import type { MicroRepairResult } from '@fixora/core-analysis';
import { isUserFacingError } from '@fixora/shared-types';
import type { AiRunRequest, AiRunResponse, Finding, Language } from '@fixora/shared-types';
import { app, type BrowserWindow } from 'electron';

import type { FindingsRepository, RepairHistoryRepository } from '../db/repositories.js';
import { emitToWindow } from '../ipc/emit.js';
import { readTextFile } from '../services/fs/fs-service.js';
import type { WorkspaceService } from '../services/workspace-service.js';
import type { VerificationService } from '../verification/verification-service.js';

import type { KeyStore } from './key-store.js';
import { projectConventions, repairNeighbours } from './repair-context.js';
import { evaluateRepairEligibility } from './repair-eligibility.js';

/**
 * The AI run orchestrator (AI-Pipeline). It is the only thing in main that talks to a provider, and it
 * does so BYOK — direct to OpenRouter with the user's key, never through a server. Every run is grounded
 * on a stored deterministic finding, built into a context, and passed through the secret gate before a
 * single byte leaves the machine. A repair is then **verified** on an overlay before it is shown, so the
 * proposal the user sees already carries its verdict (ADR-003).
 */

const EXT_LANGUAGE: Record<string, Language> = {
  ts: 'typescript',
  tsx: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  py: 'python',
  go: 'go',
};

/** Path → language. Exported so Proceed Mode uses the SAME mapping the repair path does. */
export function languageFor(relPath: string): Language | null {
  const ext = relPath.split('.').pop()?.toLowerCase() ?? '';
  return EXT_LANGUAGE[ext] ?? null;
}

export interface AiServiceDeps {
  keyStore: KeyStore;
  findings: FindingsRepository;
  workspace: WorkspaceService;
  verification: VerificationService;
  history: RepairHistoryRepository;
  /** Injected so tests can drive a fake provider; defaults to the real OpenRouter adapter. */
  providerFactory?: (key: string) => AIProvider;
  /** Injected for tests; defaults to the path-guarded, secret-denylisted reader. */
  readFile?: (rootPath: string, relPath: string) => string;
  /**
   * Q2 Fix #2A: apply a tool-authored autofix (ESLint's `fix`, Ruff's edits) for a `safe-auto`
   * finding. Routed through the analysis worker — same reason `resolveScope` is — because
   * `deterministicRepair` depends on the ESM + tree-sitter-WASM engine, which cannot load in this
   * (CJS) process. Required, not defaulted: there is no safe in-main implementation to fall back to.
   */
  microRepair: (input: {
    finding: Finding;
    source: string;
    language: Language;
    filePath: string;
  }) => Promise<MicroRepairResult | null>;
  appMeta?: { url?: string; name?: string };
}

export interface AiService {
  run(request: AiRunRequest, window: BrowserWindow | null): Promise<AiRunResponse>;
  cancel(): void;
}

type StreamResult = { ok: true; text: string } | { ok: false; message: string; retryable: boolean };

interface Target {
  symbolName: string | null;
  startLine: number;
  endLine: number;
}

const SCHEMA_ERROR = Symbol('schema_error');

/**
 * The last parse failure, so run() can report the real reason instead of a generic sentence.
 * Set by finalize(), read once by run().
 */
type ParseFailureInfo = {
  reason: string;
  detail: string;
  recovery: readonly string[];
  text: string;
};

export function createAiService(deps: AiServiceDeps): AiService {
  const makeProvider =
    deps.providerFactory ??
    ((key: string): AIProvider =>
      createOpenRouterProvider({
        apiKey: key,
        ...(deps.appMeta?.url !== undefined ? { appUrl: deps.appMeta.url } : {}),
        ...(deps.appMeta?.name !== undefined ? { appName: deps.appMeta.name } : {}),
      }));

  const readFile =
    deps.readFile ?? ((root: string, rel: string) => readTextFile(root, rel).content);

  let active: AbortController | null = null;

  async function streamOnce(
    provider: AIProvider,
    request: ProviderRequest,
    signal: AbortSignal,
    window: BrowserWindow | null,
    emitDeltas: boolean,
  ): Promise<StreamResult> {
    let text = '';
    for await (const event of provider.stream(request, signal)) {
      if (event.type === 'text_delta') {
        text += event.text;
        if (emitDeltas && window !== null) emitToWindow(window, 'ai:delta', { text: event.text });
      } else if (event.type === 'error') {
        // Carry the provider's own explanation through. Reporting only the code turned every
        // failure into "Provider error (HTTP 404)" — technically true, and useless: the reason
        // ("model not found", "insufficient credits") was already in hand and was being dropped here.
        // The exact URL and model, alongside the provider's own words. Never the key or the payload.
        console.error('[ai] provider error', {
          url: OPENROUTER_ENDPOINT,
          model: request.model,
          code: event.providerCode,
          message: event.message,
        });
        // Classified, not echoed (P2.2.1). The raw string — "429 Too Many Requests — Rate limit
        // exceeded: free-models-per-day…" — is correct for the log above and useless in a panel.
        // Repair and Proceed share this classifier so they can never disagree about what a 429 means,
        // or whether it's worth retrying.
        const failure = describeProviderFailure({
          providerCode: event.providerCode,
          detail: event.message,
          retryable: event.retryable,
        });
        return { ok: false, message: failure.message, retryable: failure.retryable };
      }
    }
    return { ok: true, text };
  }

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

  return {
    cancel() {
      active?.abort();
      active = null;
    },

    async run(request, window): Promise<AiRunResponse> {
      const key = deps.keyStore.getKey();
      if (key === null) {
        return {
          status: 'error',
          code: 'no_key',
          message: 'Add your provider key in Settings → AI.',
        };
      }
      const workspace = deps.workspace.getCurrent();
      if (workspace === null) {
        return { status: 'error', code: 'not_found', message: 'Open a workspace first.' };
      }
      const finding = deps.findings.getByFindingId(workspace.id, request.findingId);
      if (finding === null) {
        return {
          status: 'error',
          code: 'not_found',
          message: 'That finding is no longer available.',
        };
      }
      const language = languageFor(finding.location.file);
      if (language === null) {
        return {
          status: 'error',
          code: 'not_found',
          message: 'Unsupported file type for AI actions.',
        };
      }

      // Repair eligibility (P0.1 Part 2): decide, with a precise reason, whether this finding can be
      // repaired at all — before any model call. Availability depends only on language, rule and model
      // (Part 4), never on the workspace. Model capability is enforced downstream by the provider/
      // schema path, so here it is not pre-judged (repairCapable: true); the language and manual-rule
      // decisions ARE final and short-circuit with the engine's exact reason, never a generic one.
      let repairMethod: 'deterministic' | 'ai' | null = null;
      if (request.profile === 'repair') {
        const eligibility = evaluateRepairEligibility({
          language,
          ruleId: finding.ruleId,
          repairability: finding.repair,
          provider: 'openrouter',
          model: deps.keyStore.getConfig().model,
          repairCapable: true,
        });
        if (!eligibility.repairable && eligibility.reason !== null) {
          console.error('[ai:run] repair not eligible', {
            ruleId: finding.ruleId,
            repairability: finding.repair,
            reason: eligibility.reason,
          });
          return { status: 'error', code: 'not_found', message: eligibility.reason };
        }
        repairMethod = eligibility.method;
      }

      let content: string;
      try {
        content = readFile(workspace.rootPath, finding.location.file);
      } catch (error) {
        // The fs layer authors a precise, actionable reason — "no longer exists", "open in another
        // program", "permission denied", "on the secrets denylist". Surface THAT verbatim, never a
        // vague "could not read the file", so the user learns exactly why the repair cannot proceed
        // and how to fix it (P0 Priority 1: explain exactly why, never hide behind a generic string).
        const message = isUserFacingError(error)
          ? error.message
          : `Could not read ${finding.location.file}. It may have been moved, renamed, or had its permissions changed since analysis — re-run analysis and try again.`;
        console.error('[ai:run] file read failed', {
          file: finding.location.file,
          authored: isUserFacingError(error),
          message,
        });
        return { status: 'error', code: 'not_found', message };
      }

      // Deterministic micro-repair (Q2 Fix #2A): a tool-authored autofix (finding.repair ===
      // 'safe-auto') needs no model at all — `evaluateRepairEligibility` already computes
      // `method: 'deterministic'` for it. Runs `deterministicRepair` in the analysis worker (Q2 Fix
      // #2 proved a direct import of `@fixora/core-analysis` into this CJS main process throws
      // `ERR_REQUIRE_ESM`), then feeds the result through the SAME `verify()` gate and `AiProposal`
      // shape the AI path uses below — nothing downstream (history, the client-side apply gate, the
      // UI) needs to know a model was never called. Never falls through to AI on failure: a
      // `safe-auto` finding's repairability was decided by the analyzer, not by whether the model
      // pipeline happens to be reachable, so a failure here is a typed refusal, not a silent retry
      // with a different (unproven, unrequested) strategy.
      if (request.profile === 'repair' && repairMethod === 'deterministic') {
        let micro: MicroRepairResult | null;
        try {
          micro = await deps.microRepair({
            finding,
            source: content,
            language,
            filePath: finding.location.file,
          });
        } catch (error) {
          // A worker timeout/crash is a transport failure, not a verdict on the fix — typed the same
          // way every other failure in this block is, so the caller never has to distinguish "the
          // repair was unsafe" from "the process that would have computed it died".
          console.error('[ai:run] deterministic repair worker failed', {
            ruleId: finding.ruleId,
            message: error instanceof Error ? error.message : String(error),
          });
          return {
            status: 'error',
            code: 'not_found',
            message: `The automatic fix for ${finding.ruleId} could not be computed right now. Re-run analysis and try again.`,
          };
        }
        if (!micro?.parseOk) {
          console.error('[ai:run] deterministic repair could not be applied cleanly', {
            ruleId: finding.ruleId,
            hasAutofix: finding.autofix !== undefined,
            parseOk: micro?.parseOk ?? null,
          });
          return {
            status: 'error',
            code: 'not_found',
            message: `The automatic fix for ${finding.ruleId} could not be applied safely to this file.`,
          };
        }
        const lineCount = content.split(/\r?\n/).length;
        const { report, originalCode } = await deps.verification.verify({
          finding,
          repairedCode: micro.patched,
          target: { file: finding.location.file, startLine: 1, endLine: lineCount, language },
          workspaceRoot: workspace.rootPath,
          originalContent: content,
          originalFindings: deps.findings.list(workspace.id, { relPath: finding.location.file }),
        });
        const rationale = `Applied ${micro.source}'s own fix for ${finding.ruleId} — no model was used.`;
        const historyId = deps.history.record({
          workspaceId: workspace.id,
          findingId: finding.id,
          relPath: finding.location.file,
          symbolName: null,
          ruleId: finding.ruleId,
          source: finding.source,
          verdict: report.verdict,
          rationale,
          originalCode,
          repairedCode: micro.patched,
          model: null,
          confidence: 1,
          startLine: 1,
          endLine: lineCount,
        });
        if (window !== null) emitToWindow(window, 'ai:runState', { status: 'done' });
        return {
          status: 'ok',
          proposal: {
            profile: 'repair',
            historyId,
            repairedCode: micro.patched,
            originalCode,
            rationale,
            confidence: 1,
            target: {
              file: finding.location.file,
              startLine: 1,
              endLine: lineCount,
              symbolName: null,
            },
            verification: report,
          },
        };
      }

      // The repair target is the smallest self-contained AST scope the analyzer resolved for this
      // finding (Repair Context Engine v2): the least code that still parses independently and splices
      // safely. It is preferred over the whole enclosing symbol so a one-line fix does not regenerate
      // an entire function, and it is never a partial fragment (the TS2322-in-an-object-literal that
      // the parser rejected). The enclosing symbol still supplies the label; the finding's bare line is
      // a last resort, reached only when analysis produced no scope at all (e.g. the file did not
      // parse). enclosingRange is always >= a complete statement, so the target always compiles.
      const symbol = finding.evidence.enclosingSymbol;
      const scope = finding.evidence.enclosingRange;
      const target: Target = scope
        ? { symbolName: symbol?.name ?? null, startLine: scope.startLine, endLine: scope.endLine }
        : symbol
          ? {
              symbolName: symbol.name,
              startLine: symbol.location.startLine,
              endLine: symbol.location.endLine,
            }
          : {
              symbolName: null,
              startLine: finding.location.startLine,
              endLine: finding.location.endLine,
            };

      // v3 context layers: the Semantic + Dependency neighbours the analyzer selected (sliced from the
      // current file), and the Project Metadata conventions detected from the project itself.
      const context = buildContext({
        filePath: finding.location.file,
        language,
        fileContent: content,
        finding,
        target,
        neighbours: repairNeighbours(content, finding),
        conventions: projectConventions({
          language,
          fileContent: content,
          workspaceRoot: workspace.rootPath,
        }),
        budget: DEFAULT_BUDGETS[request.profile],
      });

      const prepared = prepareRequest(request.profile, context, {
        model: deps.keyStore.getConfig().model,
        maxOutputTokens: DEFAULT_BUDGETS[request.profile].reserveForOutput,
      });
      if (!prepared.ok) {
        if (window !== null) emitToWindow(window, 'ai:runState', { status: 'blocked' });
        return { status: 'blocked', matches: prepared.blocked.map((m) => ({ ...m })) };
      }

      const controller = new AbortController();
      active?.abort();
      active = controller;
      if (window !== null) emitToWindow(window, 'ai:runState', { status: 'running' });

      const provider = makeProvider(key);
      const wantsStructured = profileWantsStructuredOutput(request.profile);
      // A ref rather than a `let`: finalize() assigns it from inside a closure, and TypeScript's
      // control-flow analysis cannot see that, so it narrows a plain `let` to `null` at every read.
      const lastFailure: { current: ParseFailureInfo | null } = { current: null };

      // Turn a raw completion into a response. `repair` verifies on an overlay before returning; a
      // schema violation returns the SCHEMA_ERROR sentinel so run() can re-ask exactly once.
      const finalize = async (text: string): Promise<AiRunResponse | typeof SCHEMA_ERROR> => {
        if (request.profile === 'explain') {
          return { status: 'ok', proposal: { profile: 'explain', explanation: text } };
        }
        if (request.profile === 'test') {
          const parsed = parseTestOutput(text);
          if (!parsed.ok) {
            lastFailure.current = {
              reason: parsed.reason,
              detail: parsed.detail,
              recovery: parsed.recovery,
              text: parsed.text,
            };
            return SCHEMA_ERROR;
          }
          return {
            status: 'ok',
            proposal: {
              profile: 'test',
              framework: parsed.value.framework,
              testCode: parsed.value.testCode,
              rationale: parsed.value.rationale,
            },
          };
        }
        const parsed = parseRepairOutput(text);
        if (!parsed.ok) {
          lastFailure.current = {
            reason: parsed.reason,
            detail: parsed.detail,
            recovery: parsed.recovery,
            text: parsed.text,
          };
          return SCHEMA_ERROR;
        }
        // Recovery is reported, never silent — that is the whole justification for unwrapping.
        if (parsed.recovery.length > 0 && parsed.recovery[0] !== 'none') {
          console.error('[ai] recovered model output', {
            profile: request.profile,
            model: prepared.request.model,
            recovery: parsed.recovery,
          });
        }
        const { report, originalCode } = await deps.verification.verify({
          finding,
          repairedCode: parsed.value.repairedCode,
          target: {
            file: finding.location.file,
            startLine: target.startLine,
            endLine: target.endLine,
            language,
          },
          workspaceRoot: workspace.rootPath,
          originalContent: content,
          originalFindings: deps.findings.list(workspace.id, { relPath: finding.location.file }),
        });
        // Record every reviewed repair in the local audit trail (Beta Phase E), whatever the verdict —
        // an unresolved or regressed attempt is part of the history too. Apply stamps it later.
        const historyId = deps.history.record({
          workspaceId: workspace.id,
          findingId: finding.id,
          relPath: finding.location.file,
          symbolName: target.symbolName,
          ruleId: finding.ruleId,
          source: finding.source,
          verdict: report.verdict,
          rationale: parsed.value.rationale,
          originalCode,
          repairedCode: parsed.value.repairedCode,
          model: deps.keyStore.getConfig().model,
          confidence: parsed.value.confidence,
          startLine: target.startLine,
          endLine: target.endLine,
        });
        return {
          status: 'ok',
          proposal: {
            profile: 'repair',
            historyId,
            repairedCode: parsed.value.repairedCode,
            originalCode,
            rationale: parsed.value.rationale,
            confidence: parsed.value.confidence,
            target: {
              file: finding.location.file,
              startLine: target.startLine,
              endLine: target.endLine,
              symbolName: target.symbolName,
            },
            verification: report,
          },
        };
      };

      try {
        let stream = await streamOnce(
          provider,
          prepared.request,
          controller.signal,
          window,
          !wantsStructured,
        );
        if (controller.signal.aborted)
          return { status: 'error', code: 'cancelled', message: 'Cancelled.' };
        if (!stream.ok) {
          if (window !== null)
            emitToWindow(window, 'ai:runState', { status: 'error', message: stream.message });
          return {
            status: 'error',
            code: 'provider_error',
            message: stream.message,
            retryable: stream.retryable,
          };
        }

        let response = await finalize(stream.text);
        if (response === SCHEMA_ERROR && wantsStructured) {
          stream = await streamOnce(
            provider,
            reAskRequest(prepared.request, stream.text),
            controller.signal,
            window,
            false,
          );
          if (stream.ok) response = await finalize(stream.text);
        }
        if (response === SCHEMA_ERROR) {
          const failure: ParseFailureInfo = lastFailure.current ?? {
            reason: 'unknown',
            detail: 'The response could not be parsed and no reason was recorded.',
            recovery: [],
            text: '',
          };
          // The raw response, on disk, whenever parsing fails. Without it "the model returned
          // something invalid" is unfalsifiable — nobody can see what it actually returned.
          const debugPath = writeParseFailureDump({
            model: prepared.request.model,
            profile: request.profile,
            failure,
          });
          console.error('[ai] parse failed', {
            model: prepared.request.model,
            profile: request.profile,
            reason: failure.reason,
            recovery: failure.recovery,
            textLength: failure.text.length,
            dump: debugPath,
          });
          const message =
            failure.detail +
            (debugPath === null ? '' : ` The raw response was saved to ${debugPath}.`);
          if (window !== null) emitToWindow(window, 'ai:runState', { status: 'error', message });
          return { status: 'error', code: 'schema_error', message };
        }

        if (window !== null) {
          emitToWindow(window, 'ai:runState', {
            status: response.status === 'ok' ? 'done' : 'error',
            ...(response.status === 'error' ? { message: response.message } : {}),
          });
        }
        return response;
      } finally {
        if (active === controller) active = null;
      }
    },
  };
}

/**
 * Write the unparseable response to disk and return its path.
 *
 * A parse failure is the one error where the evidence is destroyed by default: the text existed only
 * in memory, so "the model returned something invalid" could never be checked by the person it
 * happened to. The dump makes it checkable. Best-effort by design — a failed write must not replace
 * the real error with a filesystem error.
 */
function writeParseFailureDump(input: {
  model: string;
  profile: string;
  failure: { reason: string; detail: string; recovery: readonly string[]; text: string };
}): string | null {
  try {
    const dir = join(app.getPath('userData'), 'debug', 'ai-parse-failures');
    mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const file = join(dir, `${stamp}-${input.profile}.json`);
    writeFileSync(
      file,
      `${JSON.stringify(
        {
          at: new Date().toISOString(),
          model: input.model,
          profile: input.profile,
          reason: input.failure.reason,
          detail: input.failure.detail,
          recoveryAttempted: input.failure.recovery,
          rawResponse: input.failure.text,
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
    return file;
  } catch {
    return null;
  }
}
