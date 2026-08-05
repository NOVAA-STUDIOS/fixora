import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  buildContext,
  buildReAskMessage,
  buildLintOnlyReAskMessage,
  buildVerificationReAskMessage,
  describeModelOutputFailure,
  describeProviderFailure,
  describeSchemaFailureForUser,
  estimateComplexity,
  DEFAULT_BUDGETS,
  parseRepairOutput,
  parseTestOutput,
  prepareRequest,
  profileWantsStructuredOutput,
  type ProviderFailure,
  type ProviderMessage,
  type ProviderRequest,
  type AIProvider,
} from '@fixora/core-ai';
import type { MicroRepairResult, RepairScope, RootCauseGroup } from '@fixora/core-analysis';
import {
  classifyDiagnostic,
  detectDependentFailure,
  detectLintOnlyFailure,
  isUserFacingError,
} from '@fixora/shared-types';
import type {
  AiFailure,
  AiRunRequest,
  AiRunResponse,
  AiRunStage,
  Finding,
  Language,
  RepairHistoryAttempt,
  RepairMode,
  RepairSummary,
  RepairSummaryEntry,
  RootCauseInfo,
  VerificationReport,
} from '@fixora/shared-types';
import { app, type BrowserWindow } from 'electron';

import type { FindingsRepository, RepairHistoryRepository } from '../db/repositories.js';
import { emitToWindow } from '../ipc/emit.js';
import { readTextFile } from '../services/fs/fs-service.js';
import type { WorkspaceService } from '../services/workspace-service.js';
import { spliceLines } from '../verification/patch.js';
import type { VerificationService } from '../verification/verification-service.js';

import { logProviderFailure, missingKeyFailure, toWireFailure } from './failure-report.js';
import type { KeyStore } from './key-store.js';
import { checksum, emitTrace, newTrace } from './pipeline-trace.js';
import type { ChainRefusal, Orchestrator } from './providers/orchestrator.js';
import { projectConventions, repairNeighbours } from './repair-context.js';
import { evaluateRepairEligibility } from './repair-eligibility.js';
import { RepairTraceBuilder } from './repair-trace.js';

/**
 * The AI run orchestrator (AI-Pipeline). It is the only thing in main that talks to a provider, and it
 * does so BYOK — direct to OpenRouter with the user's key, never through a server. Every run is grounded
 * on a stored deterministic finding, built into a context, and passed through the secret gate before a
 * single byte leaves the machine. A repair is then **verified** on an overlay before it is shown, so the
 * proposal the user sees already carries its verdict (ADR-003).
 */

// Kept in sync with `packages/core-analysis/src/language.ts`'s `EXTENSION_LANGUAGE` by hand, not by
// import: that package is ESM (tree-sitter-WASM) and cannot be `require`d into this CJS main process
// (see the `deterministicRepair` comment below — the same constraint routes that call through the
// analysis worker instead). A prior drift here (missing `pyi`/`json`) meant a file the Analyzer
// happily produced findings for was rejected by Repair/Proceed as "unsupported" — bug-fix sprint,
// Phase 1: this map must list every extension `languageForPath` does, or that gap reopens silently.
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
  pyi: 'python',
  go: 'go',
  json: 'json',
  css: 'css',
  html: 'html',
  htm: 'html',
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
  /**
   * Decides which provider answers, in the user's priority order, and owns failover.
   *
   * The service no longer constructs a provider at all: it asks for text and gets text. That is what
   * keeps the repair pipeline provider-blind now that there is more than one to choose between.
   */
  orchestrator: Orchestrator;
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
  /**
   * Provider health, written as a side effect of work that was happening anyway.
   *
   * Optional and observer-only: it is called AFTER an outcome is decided, nothing in this file reads
   * it back, and every call is wrapped so a throw here cannot reach the repair. A missing store is
   * simply no health data — never a degraded repair.
   */
  health?: {
    recordSuccess(providerId: string, model: string, latencyMs: number): void;
    recordFailure(
      providerId: string,
      model: string,
      category: AiFailure['category'],
      rateLimit?: { remaining?: number; limit?: number; resetAt?: number },
    ): void;
  };
}

/**
 * What the user is told when there is nothing to try.
 *
 * Three causes with three different fixes. Collapsing them into "no key configured" — which is what
 * a single-provider world could get away with — would send a user with a perfectly good key to
 * re-enter it because their only enabled provider could not do structured output.
 */
const CHAIN_REFUSAL_MESSAGE: Record<ChainRefusal, string> = {
  'none-enabled':
    'No AI provider is enabled yet. Turn one on in Settings to use AI repairs — analysis works without one.',
  'no-credentials':
    'Your enabled AI providers have no API key yet. Add a key in Settings to use AI repairs.',
  'no-capable-provider':
    'None of your enabled providers can produce a structured repair with their selected model. Choose a different model in Settings.',
};

export interface AiService {
  run(request: AiRunRequest, window: BrowserWindow | null): Promise<AiRunResponse>;
  cancel(): void;
}

type StreamResult =
  | { ok: true; text: string }
  /**
   * The failure travels classified, not as a sentence. The service used to keep only `message` and
   * `retryable`, which meant every caller that wanted to say *what kind* of failure it was had to
   * re-derive it from the prose — or, in practice, not say at all.
   */
  | { ok: false; message: string; retryable: boolean; failure: ProviderFailure };

interface Target {
  symbolName: string | null;
  startLine: number;
  endLine: number;
}

const SCHEMA_ERROR = Symbol('schema_error');

/**
 * How many times a patch that failed verification is re-asked with the verifier's diagnostic fed
 * back in, before the panel settles for showing it with Apply disabled.
 *
 * Three, because each one is a full provider round-trip: the user waits for it and pays for it, and
 * a model that has missed three times with the exact failure quoted back at it is not usually one
 * more attempt away. The gate itself is unchanged — the final verdict still decides Apply.
 */
const VERIFY_RETRY_LIMIT = 3;

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

/**
 * What the patch fixed and what it left alone, for the panel's Repair Summary.
 *
 * `skipped` is the part that matters: a minimal patch that silently leaves other problems in the file
 * untouched looks identical to one that missed them. Naming each skipped problem with its reason is
 * what makes minimality read as a deliberate choice rather than an incomplete job.
 */
function buildRepairSummary(input: {
  finding: Finding;
  related: readonly Finding[];
  others: readonly Finding[];
}): RepairSummary {
  const entry = (f: Finding, reason?: string): RepairSummaryEntry => ({
    ruleId: f.ruleId,
    line: f.location.startLine,
    message: f.message,
    ...(reason !== undefined ? { reason } : {}),
  });
  return {
    fixed: [entry(input.finding)],
    related: input.related.map((f) => entry(f)),
    skipped: input.others.map((f) =>
      entry(
        f,
        f.repair === 'manual'
          ? 'Needs your judgment — no automatic or AI fix exists for this rule.'
          : 'Outside the repair scope. Repair it separately to keep this patch minimal.',
      ),
    ),
  };
}

/** The Root Cause View (Advanced Repair only) — null when the mode is anything else. */
function buildRootCauseInfo(input: {
  mode: RepairMode;
  selected: Finding;
  group: RootCauseGroup | null;
}): RootCauseInfo | undefined {
  if (input.mode !== 'advanced' || input.group === null) return undefined;
  const { rootCause, affected } = input.group;
  return {
    basis: input.group.basis,
    ruleId: rootCause.ruleId,
    message: rootCause.message,
    line: rootCause.location.startLine,
    differsFromSelection: rootCause.id !== input.selected.id,
    affected: affected.map((f) => ({ ruleId: f.ruleId, line: f.location.startLine, message: f.message })),
  };
}

export function createAiService(deps: AiServiceDeps): AiService {
  const orchestrator = deps.orchestrator;

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
    const startedAt = Date.now();
    for await (const event of provider.stream(request, signal)) {
      if (event.type === 'text_delta') {
        text += event.text;
        if (emitDeltas && window !== null) emitToWindow(window, 'ai:delta', { text: event.text });
      } else if (event.type === 'error') {
        // Classified, not echoed (P2.2.1). The raw string — "429 Too Many Requests — Rate limit
        // exceeded: free-models-per-day…" — is correct for a log and useless in a panel. Repair and
        // Proceed share this classifier so they can never disagree about what a 429 means, or
        // whether it's worth retrying. The provider's own words are an INPUT to the classification
        // (they are what separates a throttle from an exhausted quota) and never an output.
        const failure = describeProviderFailure({
          providerCode: event.providerCode,
          detail: event.message,
          retryable: event.retryable,
        });
        // The diagnostic half, to the developer log only: status, request id, latency, the raw text.
        // Never the key and never the payload.
        logProviderFailure(failure, {
          provider: 'openrouter',
          model: request.model,
          status: event.status,
          errorCode: event.providerCode,
          latencyMs: Date.now() - startedAt,
          requestId: event.requestId,
          retryable: failure.retryable,
          detail: event.message,
        });
        return {
          ok: false,
          message: failure.message,
          retryable: failure.retryable,
          failure,
        };
      }
    }
    return { ok: true, text };
  }

  function reAskRequest(
    request: ProviderRequest,
    previous: string,
    failure: ParseFailureInfo | null,
  ): ProviderRequest {
    return followUpRequest(
      request,
      previous,
      buildReAskMessage(failure ?? { reason: 'unknown', detail: '' }),
    );
  }

  /**
   * Continue the same conversation: the model's own previous answer, then a correction. Shared by
   * the schema re-ask and the verification retry so both stay a genuine follow-up rather than a
   * fresh request that happens to look similar.
   */
  function followUpRequest(
    request: ProviderRequest,
    previous: string,
    correction: string,
  ): ProviderRequest {
    const messages: ProviderMessage[] = [
      ...request.messages,
      { role: 'assistant', content: previous },
      { role: 'user', content: correction },
    ];
    return { ...request, messages };
  }

  return {
    cancel() {
      active?.abort();
      active = null;
    },

    async run(request, window): Promise<AiRunResponse> {
      /**
       * Report which phase the run is in. A repair is several seconds of work across context
       * assembly, the provider, and the verification worker; emitting all of it as one "running"
       * made a slow repair indistinguishable from a hung one, for the user and for a bug report
       * alike. Fire-and-forget by design — progress reporting must never be able to fail a run.
       */
      const stage = (name: AiRunStage): void => {
        if (window !== null)
          emitToWindow(window, 'ai:runState', { status: 'running', stage: name });
      };

      stage('preparing');
      /**
       * NO credential check here — deliberately.
       *
       * This used to gate on the legacy v1 `keyStore`, which holds a single unnamed key that
       * `ai:setKey` only ever wrote for OpenRouter. Once credentials became per-provider, that gate
       * was asking the wrong store: a user whose only key was configured for Gemini through the
       * Provider Manager had an empty v1 store, so Repair refused with "add your key in Settings"
       * and never reached the orchestrator at all — a registry-configured provider was unusable
       * because a pre-registry store had nothing in it.
       *
       * Whether any usable credential exists is a property of the CHAIN, not of one slot, and the
       * orchestrator already answers it: `resolveChain` returns `no-credentials` when providers are
       * enabled but none has a key. That refusal is handled below, and it is the only place that
       * decision is made now.
       */
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
      stage('analyzing');
      const language = languageFor(finding.location.file);
      if (language === null) {
        return {
          status: 'error',
          code: 'not_found',
          // Same wording Proceed uses for the identical condition (`proceed-service.ts`) — a
          // bug-fix-sprint fix: these used to read differently for the same underlying cause.
          message: "This file type isn't supported for AI actions yet.",
        };
      }

      // Repair eligibility (P0.1 Part 2): decide, with a precise reason, whether this finding can be
      // repaired at all — before any model call. Availability depends only on language, rule and model
      // (Part 4), never on the workspace. Model capability is enforced downstream by the provider/
      // schema path, so here it is not pre-judged (repairCapable: true); the language and manual-rule
      // decisions ARE final and short-circuit with the engine's exact reason, never a generic one.
      let repairMethod: 'deterministic' | 'ai' | null = null;
      if (request.profile === 'repair') {
        // Diagnostic Classifier (launch blocker fix): a config/environment diagnostic — missing
        // types, an unresolved module, a tsconfig gap — is not a source-code defect, and no edit to
        // this file can resolve it. Classified here, BEFORE eligibility is even evaluated, so it
        // short-circuits with its exact fix and never reaches the model — the same gate the renderer
        // already applies via `repairStateFor` to disable the button, kept in main as defense in
        // depth for any caller that reaches `ai:run` directly.
        const configDiagnosis = finding.source === 'tsc' ? classifyDiagnostic(finding) : null;
        const eligibility = evaluateRepairEligibility({
          language,
          ruleId: finding.ruleId,
          repairability: finding.repair,
          // Null, not a guess: the chain has not resolved a candidate yet, and this field is carried
          // for the record only — no eligibility decision reads it. Naming OpenRouter here put a
          // provider the user may not even have enabled into the record.
          provider: null,
          // Still the legacy configured model, and deliberately unchanged here. The only decision
          // this field drives is a `=== null` check meaning "no model selected", which cannot happen
          // in the registry world (every provider entry carries at least its descriptor default), so
          // it is vestigial — but the real model is not known until the chain resolves one, and
          // resolving it twice per repair to populate a record would cost a catalogue round trip.
          model: deps.keyStore.getConfig().model,
          repairCapable: true,
          configDiagnosis,
        });
        if (!eligibility.repairable && eligibility.reason !== null) {
          console.error('[ai:run] repair not eligible', {
            ruleId: finding.ruleId,
            repairability: finding.repair,
            configIssue: configDiagnosis !== null,
            reason: eligibility.reason,
          });
          return { status: 'error', code: 'not_found', message: eligibility.reason };
        }
        repairMethod = eligibility.method;
      }

      /**
       * One trace per run, threaded through every stage below. Observes only — no branch reads it,
       * so it can never change a verdict. It exists so a disabled Apply can be explained from the
       * log alone: which revision was repaired, which patch was verified, by which model, and which
       * stage decided.
       */
      const trace2 = newTrace(randomUUID());
      trace2.configuredModel = deps.keyStore.getConfig().model;

      let content: string;
      try {
        content = readFile(workspace.rootPath, finding.location.file);
        trace2.documentChecksum = checksum(content);
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
        stage('validating');
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
            // The deterministic path applies one tool-authored autofix and never merges: the edit is
            // the tool's own, and widening it would make it ours.
            mode: 'finding' as const,
            repairSummary: buildRepairSummary({
              finding,
              related: [],
              others: deps.findings
                .list(workspace.id, { relPath: finding.location.file })
                .filter((f) => f.id !== finding.id),
            }),
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

      /**
       * Mode decides the SPLICE RANGE, and the splice range is the blast radius.
       *
       *  - `finding` / `related-scope` keep the resolved scope exactly. `related-scope` does not widen
       *    the patch; it only lets the same patch resolve everything already inside it. That is what
       *    makes the merge safe: minimality is unchanged, only thoroughness improves.
       *  - `ai-file` replaces the whole file. That is the largest edit the app can make, which is why
       *    it is advanced-only, warned before it runs, and never selected automatically.
       */
      const mode: RepairMode = request.mode ?? 'finding';
      const fileLineCount = content.split(/\r?\n/).length;

      // Every other finding in this file, split by whether it falls inside the patch range. Only
      // those inside can be fixed by this patch — anything outside would need a wider splice, which
      // is exactly what the mode ladder exists to keep the user in control of.
      const siblings = deps.findings
        .list(workspace.id, { relPath: finding.location.file })
        .filter((f) => f.id !== finding.id);

      // Advanced Repair: root-cause grouping (pure, no model call — see root-cause-grouping.ts).
      // Computed here, before `patchTarget`, because the group DECIDES the target for this mode —
      // the splice range is the root cause's own scope, possibly widened by its group, never the
      // whole file and never a union spanning independent scattered occurrences.
      // Dynamic import, not a static one: `@fixora/core-analysis` publishes ESM only (no `require`
      // export condition), and this file is the CJS main process — a static value-import compiles
      // fine but throws ERR_PACKAGE_PATH_NOT_EXPORTED at startup, on EVERY run, whether or not
      // Advanced Repair is ever used. Every other reference to this package in `main/` is already
      // type-only for exactly this reason (erased at compile time, never reaches `require`);
      // `groupByRootCause` is the first VALUE this process needs from it, so it needs the escape
      // hatch instead: `import()` goes through the ESM loader even from inside a CJS module, which
      // resolves the package's `import` condition correctly. Paid only on an actual Advanced Repair
      // run, not on every launch.
      const advancedGroup: RootCauseGroup | null =
        mode === 'advanced'
          ? ((await import('@fixora/core-analysis')).groupByRootCause([finding, ...siblings]).find(
              (g) =>
                g.rootCause.id === finding.id ||
                g.mergeable.some((f) => f.id === finding.id) ||
                g.affected.some((f) => f.id === finding.id),
            ) ?? null)
          : null;

      /**
       * The splice range. A `let`, because a verified-but-dependent failure can widen it — see
       * `escalateScope` below. Everything derived from it (`mergeable`, the context, the prompt) is
       * rebuilt through `buildForTarget` whenever it changes, so the model is never shown one range
       * and spliced into another.
       */
      let patchTarget: Target =
        mode === 'ai-file'
          ? { symbolName: null, startLine: 1, endLine: fileLineCount }
          : mode === 'advanced' && advancedGroup !== null
            ? {
                symbolName: advancedGroup.rootCause.evidence.enclosingSymbol?.name ?? null,
                startLine: advancedGroup.targetRange.startLine,
                endLine: advancedGroup.targetRange.endLine,
              }
            : target;

      const withinPatch = (f: Finding): boolean =>
        f.location.startLine >= patchTarget.startLine &&
        f.location.startLine <= patchTarget.endLine;
      // `manual` findings are never merged in: the analyzer already judged that no machine should
      // guess them, and bundling one into a patch would launder that refusal.
      //
      // Advanced Repair uses the GROUP's own merge decision (root-cause-grouping.ts already applied
      // the manual exclusion, and — critically — the identifier/scope distinction that decides how
      // far a patch may safely widen) rather than the generic "anything on a line inside the range"
      // rule, which would sweep in loosely-adjacent findings the grouping deliberately did not vouch
      // for.
      let mergeable: readonly Finding[] =
        mode === 'finding'
          ? []
          : mode === 'advanced'
            ? (advancedGroup?.mergeable ?? [])
            : siblings.filter((f) => withinPatch(f) && f.repair !== 'manual');
      let skipped = siblings.filter((f) => !mergeable.includes(f));

      // Manual Validation Phase 2 instrumentation. Observes only — every stage is recorded so a
      // rejected repair can be traced to the step that produced the wrong thing, rather than being
      // reported as a bare verdict.
      const trace = new RepairTraceBuilder(String(Date.now()), mode)
        .finding(finding, language)
        .target(patchTarget, content)
        .related(mergeable);

      /**
       * Build the context and the provider request for the CURRENT `patchTarget`.
       *
       * Extracted into a function purely so scope escalation can call it again. When the splice range
       * widens, the slice the model is shown, the related findings that now fall inside it, and the
       * prompt built from both must all widen with it — a request built for the old range spliced
       * into the new one would corrupt the file, which is precisely the class of bug this pipeline
       * exists to prevent.
       *
       * `prerequisite` is the verifier's explanation of why the range grew, threaded into the prompt
       * so the model is told to emit the prerequisite edit as part of the same replacement rather
       * than left to rediscover the dependency.
       */
      const buildForTarget = (
        prerequisite?: string,
      ): ReturnType<typeof prepareRequest> => {
        mergeable =
          mode === 'finding'
            ? []
            : mode === 'advanced'
              ? (advancedGroup?.mergeable ?? [])
              : siblings.filter((f) => withinPatch(f) && f.repair !== 'manual');
        skipped = siblings.filter((f) => !mergeable.includes(f));
        trace.target(patchTarget, content).related(mergeable);

        // v3 context layers: the Semantic + Dependency neighbours the analyzer selected (sliced from
        // the current file), and the Project Metadata conventions detected from the project itself.
        const built = buildContext({
          filePath: finding.location.file,
          language,
          fileContent: content,
          finding,
          target: patchTarget,
          relatedFindings: mergeable,
          neighbours: repairNeighbours(content, finding),
          conventions: projectConventions({
            language,
            fileContent: content,
            workspaceRoot: workspace.rootPath,
          }),
          budget: DEFAULT_BUDGETS[request.profile],
        });
        return prepareRequest(request.profile, built, {
          model: deps.keyStore.getConfig().model,
          maxOutputTokens: DEFAULT_BUDGETS[request.profile].reserveForOutput,
          ...(prerequisite === undefined ? {} : { prerequisite }),
        });
      };

      const prepared = buildForTarget();
      if (!prepared.ok) {
        if (window !== null) emitToWindow(window, 'ai:runState', { status: 'blocked' });
        return { status: 'blocked', matches: prepared.blocked.map((m) => ({ ...m })) };
      }
      /**
       * The request currently in force. Separate from `prepared` because scope escalation replaces it,
       * and TypeScript's narrowing of `prepared.ok` does not survive a reassignment made inside a
       * closure — the same reason the refs below exist.
       */
      let activeRequest = prepared.request;
      trace.prompt(activeRequest.messages.map((m) => `[${m.role}]\n${m.content}`).join('\n\n'));

      const controller = new AbortController();
      active?.abort();
      active = controller;
      stage('generating');

      const wantsStructured = profileWantsStructuredOutput(request.profile);
      // A ref rather than a `let`: finalize() assigns it from inside a closure, and TypeScript's
      // control-flow analysis cannot see that, so it narrows a plain `let` to `null` at every read.
      const lastFailure: { current: ParseFailureInfo | null } = { current: null };
      // Same ref pattern, same reason: `finalize` is defined before the walk runs, so it cannot see
      // `const`s the walk introduces later in the same function. Filled in once the walk resolves,
      // read inside `finalize` when it records history — Provider History (the final provider plus
      // what was tried before it).
      const usedCandidate: {
        current: { provider: string; model: string; attempts: RepairHistoryAttempt[] } | null;
      } = { current: null };
      /**
       * The verification report of the most recent repair attempt, when it FAILED its gates. Same ref
       * pattern and same reason as the two above: `finalize` writes it from inside a closure.
       *
       * A failed verification is not an error — `finalize` still returns a proposal, and the panel
       * still shows the diff with Apply disabled. This ref is what lets `run()` notice and re-ask
       * before settling for that, rather than handing the user a dead patch on the first miss.
       */
      const lastVerification: { current: VerificationReport | null } = { current: null };

      /**
       * How many times one run may widen its splice range. One: the ladder here runs from the
       * finding's own scope to its enclosing symbol, and that single step is what turns "no possible
       * patch of this range compiles" into "a patch exists". Going further would mean regenerating
       * successively larger regions on the strength of a model that has already missed twice, which
       * is the whole-file rewrite the mode ladder deliberately keeps behind a user confirmation.
       */
      const SCOPE_ESCALATION_LIMIT = 1;
      const escalations = { count: 0 };
      /**
       * The widening that happened, for the panel. Same ref pattern as the three above: written by
       * `escalateScope` and read by `finalize`, both closures.
       */
      const scopeExpansion: {
        current: {
          reason: string;
          from: { startLine: number; endLine: number };
          to: { startLine: number; endLine: number };
        } | null;
      } = { current: null };

      /**
       * Widen the splice range when — and only when — the verifier's rejection is attributable to
       * something the current range cannot reach. Returns the regenerated request, or null to leave
       * the range alone and let the caller do an ordinary re-ask.
       *
       * The rungs come from the finding's own evidence, so no re-parse is needed: `enclosingRange` is
       * the smallest self-contained scope (the statement), `enclosingSymbol.location` is the function
       * or class around it. `widenRepairScope` picks between them, and enforces that the result is
       * strictly larger, contains every prerequisite line, and stays at or below the `function` cap.
       */
      const escalateScope = async (failed: VerificationReport): Promise<ProviderRequest | null> => {
        if (escalations.count >= SCOPE_ESCALATION_LIMIT) return null;
        // `ai-file` already spans the file — there is nothing above it but the file itself.
        if (mode === 'ai-file') return null;

        const dependent = detectDependentFailure(failed, patchTarget);
        if (dependent === null) return null;

        // Dynamic import for the same reason `groupByRootCause` above uses one: `@fixora/core-analysis`
        // is ESM-only and this is the CJS main process, so a static value-import throws at startup.
        const { widenRepairScope } = await import('@fixora/core-analysis');
        const enclosing = finding.evidence.enclosingRange;
        const symbol = finding.evidence.enclosingSymbol;
        const candidates: RepairScope[] = [
          ...(enclosing
            ? [
                {
                  startLine: enclosing.startLine,
                  endLine: enclosing.endLine,
                  level: 'statement' as const,
                },
              ]
            : []),
          ...(symbol
            ? [
                {
                  startLine: symbol.location.startLine,
                  endLine: symbol.location.endLine,
                  level: 'function' as const,
                },
              ]
            : []),
        ];
        const wider = widenRepairScope({
          scopes: candidates,
          current: patchTarget,
          mustInclude: dependent.prerequisiteLines,
        });
        if (wider === null) return null;

        const previous = patchTarget;
        patchTarget = {
          symbolName: symbol?.name ?? previous.symbolName,
          startLine: wider.startLine,
          endLine: wider.endLine,
        };
        const rebuilt = buildForTarget(dependent.reason);
        // The wider slice is new content, so it goes through the secret gate again — and can be
        // blocked by it, if the extra lines contain a credential the narrow range did not. That is
        // the gate working, not a failure to handle: revert to the range that already passed and let
        // the caller fall back to an ordinary re-ask. Rebuilding on the way back is what keeps
        // `mergeable`, the trace and the context consistent with the range that will actually splice.
        if (!rebuilt.ok) {
          patchTarget = previous;
          buildForTarget();
          console.error('[ai:run] scope escalation blocked by the secret gate — keeping the narrow range');
          return null;
        }

        escalations.count += 1;
        activeRequest = rebuilt.request;
        scopeExpansion.current = {
          reason: dependent.reason,
          from: { startLine: previous.startLine, endLine: previous.endLine },
          to: { startLine: patchTarget.startLine, endLine: patchTarget.endLine },
        };
        console.error('[ai:run] widening repair scope — the narrow range cannot compile', {
          from: `${String(previous.startLine)}-${String(previous.endLine)}`,
          to: `${String(patchTarget.startLine)}-${String(patchTarget.endLine)}`,
          level: wider.level,
          reason: dependent.reason,
        });
        return rebuilt.request;
      };

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
        trace.rawResponse(text);
        const parsed = parseRepairOutput(text);
        if (!parsed.ok) {
          trace.parsed({ ok: false, reason: parsed.reason, detail: parsed.detail });
          lastFailure.current = {
            reason: parsed.reason,
            detail: parsed.detail,
            recovery: parsed.recovery,
            text: parsed.text,
          };
          return SCHEMA_ERROR;
        }
        trace.parsed({
          ok: true,
          repairedCode: parsed.value.repairedCode,
          rationale: parsed.value.rationale,
          confidence: parsed.value.confidence,
        });
        trace.spliced(
          spliceLines(
            content,
            patchTarget.startLine,
            patchTarget.endLine,
            parsed.value.repairedCode,
          ),
        );
        // Recovery is reported, never silent — that is the whole justification for unwrapping.
        if (parsed.recovery.length > 0 && parsed.recovery[0] !== 'none') {
          console.error('[ai] recovered model output', {
            profile: request.profile,
            model: activeRequest.model,
            recovery: parsed.recovery,
          });
        }
        stage('validating');
        // A new patch — and a new verification — on every attempt, retry and scope escalation, so the
        // ids never conflate two attempts the way a single per-run id would.
        const baseline = deps.findings.list(workspace.id, { relPath: finding.location.file });
        const verifyId = randomUUID();
        trace2.patchRequestId = randomUUID();
        trace2.verificationRequestId = verifyId;
        trace2.patchChecksum = checksum(parsed.value.repairedCode);
        trace2.patchedFileChecksum = checksum(
          spliceLines(
            content,
            patchTarget.startLine,
            patchTarget.endLine,
            parsed.value.repairedCode,
          ),
        );
        trace2.targetRange = `${String(patchTarget.startLine)}-${String(patchTarget.endLine)}`;
        trace2.baselineFindingCount = baseline.length;

        const { report, originalCode } = await deps.verification.verify({
          verifyId,
          finding,
          repairedCode: parsed.value.repairedCode,
          target: {
            file: finding.location.file,
            startLine: patchTarget.startLine,
            endLine: patchTarget.endLine,
            language,
          },
          workspaceRoot: workspace.rootPath,
          originalContent: content,
          originalFindings: baseline,
        });
        trace.verified(report);
        trace2.usedModel = usedCandidate.current?.model ?? trace2.configuredModel;
        trace2.verdict = report.verdict;
        /**
         * What the renderer's Apply gate will decide, derived from the same report it receives.
         * Mirrored rather than imported — `evaluateApplyGate` lives in the renderer bundle — so the
         * log states the outcome, not just the inputs to it. `apply-gate-parity.test.ts` is what
         * keeps this mirror honest; if the two ever diverge, that test fails.
         */
        trace2.applyEnabled =
          parsed.value.repairedCode.length > 0 && report.syntaxOk && report.verdict !== 'regression';
        trace2.decidedBy =
          parsed.value.repairedCode.length === 0
            ? 'patch-builder (empty replacement)'
            : !report.syntaxOk
              ? 'verification (parser gate)'
              : report.verdict === 'regression'
                ? 'regression-detection (new findings)'
                : 'verification (passed)';
        emitTrace(trace2, 'verdict');
        // Publish the verdict for the retry loop in `run()`. `verified` and `skipped` are settled
        // outcomes — the first passed its gates, the second had no analyzer to run them, and asking
        // a model to improve on a check that never happened would be noise, not a correction.
        lastVerification.current =
          report.verdict === 'verified' || report.verdict === 'skipped' ? null : report;
        // A rejected repair is exactly the case worth keeping evidence for. A verified one is not:
        // dumping source to disk on every success would be a privacy cost with no diagnostic return.
        if (report.verdict === 'regression' || !report.syntaxOk) {
          const tracePath = trace.write();
          console.error('[ai:run] REPAIR REJECTED — trace written', {
            ...trace.summary(),
            trace: tracePath,
          });
        }

        // Record every reviewed repair in the local audit trail (Beta Phase E), whatever the verdict —
        // an unresolved or regressed attempt is part of the history too. Apply stamps it later.
        const historyId = deps.history.record({
          workspaceId: workspace.id,
          findingId: finding.id,
          relPath: finding.location.file,
          symbolName: patchTarget.symbolName,
          ruleId: finding.ruleId,
          source: finding.source,
          verdict: report.verdict,
          rationale: parsed.value.rationale,
          originalCode,
          repairedCode: parsed.value.repairedCode,
          model: usedCandidate.current?.model ?? deps.keyStore.getConfig().model,
          provider: usedCandidate.current?.provider ?? null,
          attempts: usedCandidate.current?.attempts ?? [],
          confidence: parsed.value.confidence,
          startLine: patchTarget.startLine,
          endLine: patchTarget.endLine,
        });
        return {
          status: 'ok',
          proposal: {
            profile: 'repair',
            historyId,
            mode,
            // What this patch actually covered, and what it deliberately did not — each skip with a
            // reason, so a minimal patch reads as a choice rather than an oversight.
            repairSummary: buildRepairSummary({ finding, related: mergeable, others: skipped }),
            rootCause: buildRootCauseInfo({ mode, selected: finding, group: advancedGroup }),
            // Present only when the scope was widened, so the panel can explain why the diff covers
            // more than the line the user asked about — and, if this attempt also failed, that a
            // larger fix was tried rather than the line simply being unfixable.
            ...(scopeExpansion.current === null
              ? {}
              : { scopeExpansion: scopeExpansion.current }),
            repairedCode: parsed.value.repairedCode,
            originalCode,
            rationale: parsed.value.rationale,
            confidence: parsed.value.confidence,
            target: {
              file: finding.location.file,
              startLine: patchTarget.startLine,
              endLine: patchTarget.endLine,
              symbolName: patchTarget.symbolName,
            },
            verification: report,
          },
        };
      };

      try {
        // Provider failover, now across PROVIDERS rather than models on one key. The chain is the
        // user's registry order, filtered to what is enabled, credentialed and capable; a candidate
        // that ANSWERS ends the walk, and everything downstream — parse, verify, Apply — is
        // unchanged and runs exactly once, on that answer.
        //
        // Smart model routing: a size/complexity hint for providers the user left on "auto". This
        // NEVER reorders providers and NEVER overrides a model the user actually picked — see
        // `orchestrator.ts`. Complexity is estimated from what is actually being sent, not guessed.
        const promptChars = activeRequest.messages.reduce((n, m) => n + m.content.length, 0);
        const routingTask = {
          // Advanced Repair is definitionally the complex case — it coordinates a root cause with
          // its group rather than a single finding — so complexity is never re-estimated down for
          // it, the same way a small file with one lint nit is.
          complexity:
            mode === 'advanced'
              ? ('high' as const)
              : estimateComplexity({
                  language,
                  contentChars: promptChars,
                  findingCount: mergeable.length + 1,
                }),
          estimatedTokens: Math.ceil(promptChars / 4),
        };

        // Wall clock for the health record's latency figure. Started here, immediately before the
        // provider walk, so it measures the provider round trip rather than context assembly.
        const runStartedAt = Date.now();
        const walk = await orchestrator.run(
          request.profile,
          async (candidate) => {
            const result = await streamOnce(
              candidate.adapter,
              // Same prepared request, this candidate's model. The budget was computed for the first
              // candidate; one with a smaller window answers `context-too-large`, which is not a
              // failover category, so the walk stops and reports it honestly rather than looping.
              { ...activeRequest, model: candidate.model },
              controller.signal,
              window,
              !wantsStructured,
            );
            return result.ok
              ? { ok: true as const, value: result }
              : { ok: false as const, failure: result.failure };
          },
          {
            signal: controller.signal,
            task: routingTask,
            onFailover: (record) => {
              console.error('[ai] failing over', {
                fromProvider: record.candidate.provider,
                fromModel: record.candidate.model,
                category: record.failure.category,
                providerCode: record.failure.providerCode,
              });
              // A silent multi-second walk is indistinguishable from the hang this pipeline already
              // has a timeout for. Says "trying a backup model", so automatic recovery reads as
              // recovery rather than as a stall.
              stage('failing-over');
            },
          },
        );

        // Nothing to try at all — distinct from every candidate failing, and with a different fix.
        if ('refused' in walk) {
          const message = CHAIN_REFUSAL_MESSAGE[walk.reason];
          if (window !== null) emitToWindow(window, 'ai:runState', { status: 'error', message });
          return {
            status: 'error',
            code: 'no_key',
            message,
            // No provider and no model: the chain produced no candidate, so there is nothing
            // truthful to name. It previously reported OpenRouter and the legacy configured model
            // regardless of what the user had set up.
            failure: missingKeyFailure(),
          };
        }

        // The provider and model that actually answered — or that finally failed. Everything
        // downstream reports against these rather than the configured ones, so a card saying
        // "Provider: X · Model: Y" names where the user's failure actually came from.
        const usedProvider = walk.candidate.provider;
        const usedModel = walk.candidate.model;
        // The adapter that answered, kept for the re-ask below.
        const usedAdapter = walk.candidate.adapter;
        // Every model tried before the one being reported, so a total failure renders as ONE
        // consolidated card instead of a sequence the user has to piece together.
        const walkAttempts = walk.attempts.map((record) => ({
          provider: record.candidate.provider,
          model: record.candidate.model,
          category: record.failure.category,
        }));
        // For Provider History: which providers were tried and failed before this one, if any.
        usedCandidate.current = { provider: usedProvider, model: usedModel, attempts: walkAttempts };

        /**
         * Record health from the walk that just happened.
         *
         * Free: this is the outcome of work the user already asked for, and it is more truthful than
         * a synthetic probe because it IS the workload. Every candidate the walk tried and abandoned
         * is recorded too — otherwise a provider that failed over would look untested forever, which
         * is exactly the provider a health panel most needs to describe.
         *
         * Wrapped: health is an observer, and an observer must never be able to fail a repair.
         */
        try {
          for (const record of walk.attempts) {
            deps.health?.recordFailure(
              record.candidate.provider,
              record.candidate.model,
              record.failure.category,
              record.failure.rateLimit,
            );
          }
          if (walk.ok) {
            deps.health?.recordSuccess(usedProvider, usedModel, Date.now() - runStartedAt);
          } else {
            deps.health?.recordFailure(
              usedProvider,
              usedModel,
              walk.failure.category,
              walk.failure.rateLimit,
            );
          }
        } catch (error) {
          console.error('[health] recording failed — the repair is unaffected', error);
        }
        let stream: StreamResult = walk.ok
          ? walk.value
          : { ok: false, message: walk.failure.message, retryable: walk.failure.retryable, failure: walk.failure };

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
            // The classification the panel renders as a status card. Without it the panel has only
            // the sentence, which is what left provider outages looking like Fixora defects.
            failure: toWireFailure(stream.failure, {
              provider: usedProvider,
              model: usedModel,
              // Drop the final failure from the list: it is already the card's headline, and
              // repeating it as an "also tried" line reads as two separate failures.
              attempts: walkAttempts.slice(0, -1),
            }),
          };
        }

        let response = await finalize(stream.text);
        if (response === SCHEMA_ERROR && wantsStructured) {
          // Re-ask the SAME provider and model that answered. Switching mid-conversation would
          // send a correction about one model's output to a different model, which is incoherent.
          stream = await streamOnce(
            usedAdapter,
            { ...reAskRequest(activeRequest, stream.text, lastFailure.current), model: usedModel },
            controller.signal,
            window,
            false,
          );
          if (stream.ok) response = await finalize(stream.text);
        }

        /**
         * Verification retry. A patch that parses but fails its gates — does not compile, breaks
         * something that worked, or leaves the finding in place — is re-asked with the verifier's own
         * diagnostic fed back in, up to VERIFY_RETRY_LIMIT times.
         *
         * This does NOT weaken the gate. Every attempt is verified by the same pipeline on a fresh
         * overlay, and the LAST attempt's verdict is what the panel receives — so a repair that never
         * passes still arrives with Apply disabled and its reason intact. What changes is only that
         * the model gets told what was wrong before the user is handed a dead patch, which is exactly
         * what the schema re-ask above already does for a malformed response.
         *
         * Deliberately re-asks the same provider and model that answered, for the same reason the
         * schema re-ask does: a correction about one model's output is incoherent sent to another.
         */
        // `signal.aborted` is mutated outside this function's control flow, which TypeScript narrows
        // away on a direct read after the earlier guard — read it through a call, the same shape
        // `failover.ts` uses for exactly this reason.
        const aborted = (): boolean => controller.signal.aborted;
        // The text of the most recent successful completion. Tracked separately rather than
        // reassigning `stream`, whose ok-variant narrowing does not survive the schema re-ask's
        // reassignment above. The empty fallback is unreachable in practice — a failed stream leaves
        // `response` as SCHEMA_ERROR, which the loop condition already excludes.
        let lastText = stream.ok ? stream.text : '';
        /** Lint-targeted retries spent. Capped at one — see the block inside the loop. */
        let lintRetries = 0;
        for (
          let attempt = 1;
          attempt <= VERIFY_RETRY_LIMIT &&
          response !== SCHEMA_ERROR &&
          lastVerification.current !== null &&
          !aborted();
          attempt += 1
        ) {
          const failed = lastVerification.current;
          console.error('[ai:run] verification failed — retrying', {
            attempt,
            of: VERIFY_RETRY_LIMIT,
            verdict: failed.verdict,
            syntaxOk: failed.syntaxOk,
            newFindingCount: failed.newFindingCount,
            model: usedModel,
          });
          stage('generating');

          /**
           * Scope escalation, before the ordinary re-ask.
           *
           * Some failures cannot be fixed by re-asking at all. When the patch parses cleanly but
           * still fails because of a declaration *outside* the range it replaced — `const data =
           * await response.json()` failing on a `response` that was never awaited — no reply confined
           * to that range compiles, and re-asking three times just spends the user's tokens on an
           * impossible question. `escalateScope` widens the splice by one AST level so the
           * prerequisite edit is inside it, and rebuilds the prompt for the wider range.
           *
           * The verifier is NOT relaxed by this: the regenerated patch goes through the same overlay
           * verification as every other attempt, and if the wider one also fails the user still gets
           * the best attempt with Apply disabled and the verifier's reason. What changes is only that
           * the model is now able to return something that can pass.
           */
          const widened = await escalateScope(failed);

          /**
           * A lint-only rejection earns ONE narrowly-targeted attempt before the patch is written off.
           *
           * When a patch parses, type-checks and resolves the reported problem, and the only new
           * findings are lint diagnostics on the lines it touched, the general re-ask ("fix the
           * problem without causing these") invites a rewrite that loses the parts already correct.
           * This asks instead for the smallest possible follow-up: keep the fix, clear the listed
           * rules, touch nothing else.
           *
           * Bounded to one attempt so a model that cannot satisfy a linter does not consume the whole
           * retry budget it might have spent on a better repair. The gate is untouched: the result is
           * verified by the identical pipeline, and if it still fails, the last verdict stands and
           * Apply stays disabled with its reason.
           */
          const lintOnly = lintRetries === 0 && widened === null ? detectLintOnlyFailure(failed) : null;
          if (lintOnly !== null) {
            lintRetries += 1;
            console.error('[ai:run] lint-only rejection — one targeted retry', {
              rules: [...new Set(lintOnly.diagnostics.map((d) => d.ruleId))],
              reason: lintOnly.reason,
            });
          }

          const retryStream = await streamOnce(
            usedAdapter,
            {
              // A widened scope means a NEW question about a larger piece of code, so it is sent as
              // a fresh grounded request rather than a follow-up to the narrow answer — continuing
              // that conversation would anchor the model to the one-line patch that just failed.
              ...(widened ??
                followUpRequest(
                  activeRequest,
                  lastText,
                  lintOnly === null
                    ? buildVerificationReAskMessage(failed)
                    : buildLintOnlyReAskMessage(lintOnly.diagnostics),
                )),
              model: usedModel,
            },
            controller.signal,
            window,
            false,
          );
          // A provider failure mid-retry is not worth surfacing over a patch we already have: the
          // previous attempt's proposal is still a real, verified-and-rejected result the user can
          // read. Stop retrying and keep it.
          if (!retryStream.ok) break;
          lastText = retryStream.text;
          const retried = await finalize(lastText);
          // A retry that comes back unparseable is a worse outcome than the patch we already hold,
          // so keep the earlier response rather than replacing it with a schema error.
          if (retried === SCHEMA_ERROR) break;
          response = retried;
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
            model: activeRequest.model,
            profile: request.profile,
            failure,
          });
          // `detail` belongs HERE and only here. It was previously omitted from this log and used as
          // the user's error message instead — exactly backwards: the field-level schema diagnostic
          // ("repairedCode: Required") is the most useful thing a maintainer can have and the least
          // useful thing a user can read.
          console.error('[ai] parse failed', {
            model: activeRequest.model,
            profile: request.profile,
            reason: failure.reason,
            detail: failure.detail,
            recovery: failure.recovery,
            textLength: failure.text.length,
            dump: debugPath,
          });
          // What the USER sees: what happened, and what to do. No schema vocabulary, no field paths,
          // and above all no absolute filesystem path — this codebase treats those as user data
          // (Security §9), and the old message pasted one straight into the panel. The dump still
          // exists for a bug report; the log above names it.
          const message = describeSchemaFailureForUser(request.profile);
          if (window !== null) emitToWindow(window, 'ai:runState', { status: 'error', message });
          return {
            status: 'error',
            code: 'schema_error',
            message,
            retryable: true,
            // The model, not the engine and not the user's code. Attributing this to Fixora is the
            // specific mistake the layer field exists to prevent.
            failure: toWireFailure(describeModelOutputFailure('schema-mismatch'), {
              provider: usedProvider,
              model: usedModel,
              attempts: walkAttempts,
            }),
          };
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
